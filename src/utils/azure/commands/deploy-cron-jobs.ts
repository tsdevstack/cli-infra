/**
 * Deploy cron jobs to Azure Container App Jobs, one per entry, each with
 * its service's image, env and secrets (as a coupled worker gets them).
 * With an image tag (deploy-services, right after the service) the job gets
 * `{acr}/{service}:{tag}`; without one (deploy-schedulers) it gets the image
 * the service's Container App runs, and a service that was never deployed
 * stops the command with the hint services get.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import {
  buildAzureTerraformEnv,
  calculatePoolSize,
  CRON_JOB_TIMEOUT,
  getTotalWorkerMaxInstances,
  type CronJobConfig,
} from '@tsdevstack/infra-core';
import type { FrameworkConfig } from '@tsdevstack/cli/plugin';
import { MIGRATION_JOB_DEFAULTS_AZURE } from '../../../constants';
import { buildRuntime } from '../../build-runtime';
import { buildAzureCronJobPlatformTimeout } from '../build-azure-cron-job-platform-timeout';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { warnIfSmallDatabasePool } from '../../deploy/warn-if-small-database-pool';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/get-service-config';
import { getTraceSampleRate } from '../../infrastructure/get-trace-sample-rate';
import type { EnvironmentOverrides } from '../../infrastructure/types';
import {
  getAcrIdentityOutputs,
  getOtlpTracesUrl,
  getServiceSecretsIdentities,
  getTerraformOutput,
} from '../terraform';
import { resolveAzureNaming } from '../naming/resolve-azure-naming';
import { buildAzureBackendEnv } from './build-azure-backend-env';
import { azureDeployCronJob } from './deploy-cron-job';
import { getDeployedContainerAppImage } from './get-deployed-container-app-image';
import type { AzureCommandContext } from './types';

export interface AzureDeployCronJobsOptions {
  /** The tag just deployed; left out, the service's deployed image is used */
  imageTag?: string;
  /** The command, for the errors */
  commandName: string;
}

export async function azureDeployCronJobs(
  ctx: AzureCommandContext,
  config: FrameworkConfig,
  jobs: CronJobConfig[],
  options: AzureDeployCronJobsOptions,
): Promise<void> {
  const { logger, CliError, DEFAULT_AZURE_DATABASE_TIER } = getContext();
  if (jobs.length === 0) return;

  const { projectRoot, projectName, targetEnv, credentials } = ctx;
  const runtime = buildRuntime();
  const tfEnv = buildAzureTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let acrLoginServer: string;
  let resourceGroupName: string;
  let containerAppsEnvId: string;
  try {
    acrLoginServer = getTerraformOutput(
      terraformDir,
      'acr_login_server',
      tfEnv,
    );
    resourceGroupName = getTerraformOutput(
      terraformDir,
      'resource_group_name',
      tfEnv,
    );
    containerAppsEnvId = getTerraformOutput(
      terraformDir,
      'container_apps_env_id',
      tfEnv,
    );
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      options.commandName,
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }
  const { managedIdentityClientId, acrManagedIdentityId } =
    getAcrIdentityOutputs(terraformDir, tfEnv);
  const secretsIdentities = getServiceSecretsIdentities(terraformDir, tfEnv);
  const otlpTracesUrl = getOtlpTracesUrl(terraformDir, tfEnv, targetEnv);
  const naming = await resolveAzureNaming(credentials, projectName, targetEnv);

  // A run connects as its service does: the service's pool size (A7: cron
  // jobs are not counted, they draw on the reserve)
  const infraConfig = loadInfrastructureConfig();
  const envConfig = infraConfig?.[targetEnv] as
    EnvironmentOverrides | undefined;
  const dbTier = envConfig?.database?.tier ?? DEFAULT_AZURE_DATABASE_TIER;
  const pool = calculatePoolSize({
    dbTier,
    provider: 'azure',
    totalServiceMaxInstances: getTotalServiceMaxInstances(
      config.services,
      infraConfig,
      targetEnv,
      'azure',
    ),
    totalWorkerMaxInstances: getTotalWorkerMaxInstances(config.services, {
      infraConfig,
      targetEnv,
    }),
  });
  warnIfSmallDatabasePool(pool, dbTier);

  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info(`Deploying ${jobs.length} cron job(s) to Container App Jobs...`);
  logger.info('════════════════════════════════════════════');

  const failures: Array<{ job: string; error: string }> = [];

  for (const job of jobs) {
    const service = config.services.find((s) => s.name === job.targetService);
    if (!service || service.type !== 'nestjs') {
      failures.push({
        job: job.name,
        error: `${job.targetService} is not a NestJS service in config.json`,
      });
      logger.error(
        `  ${job.name}: ${job.targetService} is not a NestJS service`,
      );
      continue;
    }

    const secretsIdentity = secretsIdentities[service.name];
    if (!secretsIdentity) {
      failures.push({
        job: job.name,
        error: `No Key Vault identity for ${service.name}: run infra:deploy`,
      });
      logger.error(
        `  ${job.name}: no Key Vault identity for ${service.name} (run infra:deploy)`,
      );
      continue;
    }

    const image = options.imageTag
      ? `${acrLoginServer}/${service.name}:${options.imageTag}`
      : await getDeployedContainerAppImage(
          credentials,
          resourceGroupName,
          `${projectName}-${service.name}`,
        );
    if (!image) {
      failures.push({
        job: job.name,
        error: `${service.name} is not deployed yet: npx tsdevstack infra:deploy-services --env ${targetEnv} --service ${service.name}`,
      });
      logger.error(
        `  ${job.name}: ${service.name} is not deployed yet, deploy the service first`,
      );
      continue;
    }

    const timeoutSeconds = job.timeout ?? CRON_JOB_TIMEOUT.azure.default;
    const serviceConfig = getServiceConfig(
      infraConfig,
      service.name,
      targetEnv,
      'azure',
    );
    const backendEnv = buildAzureBackendEnv({
      projectName,
      targetEnv,
      credentials,
      naming,
      serviceName: service.name,
      hasDatabase: service.hasDatabase ?? false,
      hasStorage: (config.storage?.buckets?.length ?? 0) > 0,
      poolMax: pool.poolMax,
      managedIdentityClientId,
      secretsIdentityClientId: secretsIdentity.client_id,
      logLevel: serviceConfig.logLevel,
      cronJob: { name: job.name, timeoutSeconds },
      traceSampleRate: getTraceSampleRate(infraConfig, targetEnv),
      otlpTracesUrl,
    });

    try {
      const { jobName } = await azureDeployCronJob({
        projectName,
        credentials,
        resourceGroupName,
        containerAppsEnvId,
        job,
        image,
        envVars: backendEnv.envVars,
        secrets: backendEnv.secrets,
        secretEnvVars: backendEnv.secretEnvVars,
        cpu: parseFloat(job.cpu ?? MIGRATION_JOB_DEFAULTS_AZURE.cpu),
        memory: job.memory ?? MIGRATION_JOB_DEFAULTS_AZURE.memory,
        platformTimeoutSeconds:
          buildAzureCronJobPlatformTimeout(timeoutSeconds),
        acrLoginServer,
        acrManagedIdentityId,
        secretsIdentityId: secretsIdentity.id,
      });
      logger.success(
        `  ${job.name} deployed (${jobName}, ${job.schedule}, ${image})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      failures.push({ job: job.name, error: message });
      logger.error(`  ${job.name}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new CliError(
      `Failed to deploy ${failures.length} cron job(s)`,
      options.commandName,
      failures.map((f) => `${f.job}: ${f.error}`).join('\n'),
    );
  }
}
