/**
 * Deploy workers coupled to deployed services.
 *
 * Finds workers whose baseService is in the list of deployed services,
 * then deploys each one to Azure Container Apps.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { azureDeployWorker } from './deploy-worker';
import { buildAzureBackendEnv } from './build-azure-backend-env';
import {
  buildAzureTerraformEnv,
  calculatePoolSize,
  getTotalWorkerMaxInstances,
} from '@tsdevstack/infra-core';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/get-service-config';
import type { EnvironmentOverrides } from '../../infrastructure/types';
import { getGitSha } from '../../docker';
import { buildRuntime } from '../../build-runtime';
import {
  getAcrIdentityOutputs,
  getServiceSecretsIdentities,
} from '../terraform';
import type { AzureCommandContext } from './types';
import { warnIfSmallDatabasePool } from '../../deploy/warn-if-small-database-pool';

export async function deployCoupledWorkers(
  ctx: AzureCommandContext,
  config: ReturnType<ReturnType<typeof getContext>['loadFrameworkConfig']>,
  deployedServiceNames: string[],
  tag?: string,
): Promise<void> {
  const { logger, CliError, DEFAULT_AZURE_DATABASE_TIER } = getContext();

  const coupledWorkers = config.services.filter(
    (s) =>
      s.type === 'worker' &&
      s.baseService &&
      deployedServiceNames.includes(s.baseService),
  );

  if (coupledWorkers.length === 0) return;

  // Read managed identity client ID from Terraform for Key Vault access
  const runtime = buildRuntime();
  const tfEnv = buildAzureTerraformEnv(runtime, ctx.credentials);
  const terraformDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );
  const { managedIdentityClientId } = getAcrIdentityOutputs(
    terraformDir,
    tfEnv,
  );
  // Workers read secrets as their base service
  const secretsIdentities = getServiceSecretsIdentities(terraformDir, tfEnv);

  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info(
    `Deploying ${coupledWorkers.length} worker(s) to Container Apps...`,
  );
  logger.info('════════════════════════════════════════════');

  const infraConfig = loadInfrastructureConfig();
  const envConfig = infraConfig?.[ctx.targetEnv] as
    EnvironmentOverrides | undefined;
  const dbTier = envConfig?.database?.tier ?? DEFAULT_AZURE_DATABASE_TIER;
  const totalServiceMax = getTotalServiceMaxInstances(
    config.services,
    infraConfig,
    ctx.targetEnv,
    'azure',
  );
  const totalWorkerMax = getTotalWorkerMaxInstances(config.services, {
    infraConfig,
    targetEnv: ctx.targetEnv,
  });
  const imageTag = tag ?? getGitSha();

  const workerPool = calculatePoolSize({
    dbTier,
    provider: 'azure',
    totalServiceMaxInstances: totalServiceMax,
    totalWorkerMaxInstances: totalWorkerMax,
  });
  const workerPoolMax = workerPool.poolMax;
  warnIfSmallDatabasePool(workerPool, dbTier);

  const workerFailures: Array<{ worker: string; error?: string }> = [];

  for (const worker of coupledWorkers) {
    const baseService = config.services.find(
      (s) => s.name === worker.baseService,
    );
    if (!baseService) continue;

    const secretsIdentity = secretsIdentities[baseService.name];
    if (!secretsIdentity) {
      workerFailures.push({
        worker: worker.name,
        error: `No Key Vault identity for ${baseService.name}: run infra:deploy`,
      });
      logger.error(
        `  ${worker.name}: no Key Vault identity for ${baseService.name} (run infra:deploy)`,
      );
      continue;
    }

    const backendEnv = buildAzureBackendEnv({
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials: ctx.credentials,
      serviceName: baseService.name,
      hasDatabase: baseService.hasDatabase ?? false,
      hasStorage: (config.storage?.buckets?.length ?? 0) > 0,
      poolMax: workerPoolMax,
      managedIdentityClientId,
      secretsIdentityClientId: secretsIdentity.client_id,
    });

    const workerConfig = getServiceConfig(
      infraConfig,
      worker.name,
      ctx.targetEnv,
      'azure',
    );

    try {
      await azureDeployWorker({
        projectRoot: ctx.projectRoot,
        projectName: ctx.projectName,
        targetEnv: ctx.targetEnv,
        credentials: ctx.credentials,
        worker,
        baseService,
        imageTag,
        envVars: backendEnv.envVars,
        secrets: backendEnv.secrets,
        secretEnvVars: backendEnv.secretEnvVars,
        minReplicas: Math.max(1, workerConfig.minInstances),
        maxReplicas: workerConfig.maxInstances,
        cpu: parseFloat(workerConfig.cpu),
        memory: workerConfig.memory,
        secretsIdentityId: secretsIdentity.id,
      });
      logger.success(`  ${worker.name} deployed`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      workerFailures.push({ worker: worker.name, error: errorMsg });
      logger.error(`  ${worker.name}: ${errorMsg}`);
    }
  }

  if (workerFailures.length > 0) {
    throw new CliError(
      `Failed to deploy ${workerFailures.length} worker(s)`,
      'infra:deploy-services',
      workerFailures.map((f) => `${f.worker}: ${f.error}`).join('\n'),
    );
  }
}
