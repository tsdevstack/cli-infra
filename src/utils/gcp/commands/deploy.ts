/**
 * GCP Deploy Handler
 *
 * Deploys complete infrastructure:
 * 1. Base infrastructure (VPC, DB, Redis, IAM, Artifact Registry, Load Balancer)
 * 2. Services to Cloud Run (+ IAM invoker bindings)
 * 3. Kong Gateway (+ IAM invoker binding)
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import {
  buildGcpTerraformEnv,
  checkTerraformInstalled,
  setSchedulerInvokerBindings,
} from '@tsdevstack/infra-core';
import {
  executeTerraform,
  getTerraformOutput,
  getTerraformOutputJson,
} from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { toTfVarSuffix } from '../../terraform';
import { createBucket } from '../create-bucket';
import { getGcsLocationFromRegion } from '../get-gcs-location-from-region';
import { fetchDbPasswordsFromSecretManager } from '../../credentials/fetch-db-passwords-from-secret-manager';
import { setSecretViaCli } from '../../credentials/set-secret-via-cli';
import { generateTerraformFiles } from './generate-terraform-files';
import type { GCPCommandContext, DeployOptions } from './types';
import { infraDeployServices } from '../../../commands/infra-deploy-services';
import { infraKongGenerate } from '../../../commands/infra-kong-generate';
import { infraKongBuild } from '../../../commands/infra-kong-build';
import { infraKongDeploy } from '../../../commands/infra-kong-deploy';

/**
 * Deploy GCP infrastructure
 */
export async function gcpDeploy(
  ctx: GCPCommandContext,
  options: DeployOptions,
): Promise<void> {
  const { logger, CliError, loadFrameworkConfig } = getContext();
  const runtime = buildRuntime();

  checkTerraformInstalled(runtime);

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`GCP Project: ${ctx.credentials.project_id}`);
  logger.info(`Region: ${ctx.credentials.region}`);
  logger.newline();

  // Ensure state bucket exists
  const stateBucket = `${ctx.projectName}-tf-state-${ctx.credentials.project_id}`;
  logger.info(`Ensuring state bucket exists: ${stateBucket}`);

  const bucketResult = await createBucket({
    bucketName: stateBucket,
    credentials: ctx.credentials,
    location: getGcsLocationFromRegion(ctx.credentials.region),
    versioning: true,
    labels: {
      purpose: 'tf-state',
      environment: ctx.targetEnv,
    },
  });

  if (!bucketResult.success) {
    throw new CliError(
      `Failed to create state bucket: ${bucketResult.error}`,
      'infra:deploy',
      'Check your GCP credentials and permissions',
    );
  }

  if (bucketResult.isNew) {
    logger.success(`  ✓ Created bucket: ${stateBucket}`);
  } else {
    logger.success(`  ✓ Bucket exists: ${stateBucket}`);
  }
  logger.newline();

  // Generate all Terraform files using shared function.
  // cloud-scheduler.tf is included when scheduled jobs are configured.
  // IAM bindings for schedulers are handled by deploy-schedulers (via SDK).
  const { outputDir, servicesWithDatabase, scheduledJobs } =
    generateTerraformFiles(ctx, 'infra:deploy');

  logger.complete('Configuration generated');
  logger.newline();

  // Load database passwords
  const servicesWithDb = servicesWithDatabase.filter((s) => s.hasDatabase);
  let dbPasswords: Record<string, string> = {};

  if (servicesWithDb.length > 0) {
    logger.info('Loading database passwords...');

    // Always fetch from Secret Manager (works in both local and CI with WIF)
    dbPasswords = await fetchDbPasswordsFromSecretManager(
      ctx.targetEnv,
      servicesWithDb,
    );
    logger.success('Loaded from Secret Manager');
    logger.newline();
  }

  // Build Terraform environment
  const tfEnv = buildGcpTerraformEnv(runtime, ctx.credentials);

  // Add database passwords as TF_VAR_db_{prefix}_password
  for (const [serviceName, password] of Object.entries(dbPasswords)) {
    const suffix = toTfVarSuffix(serviceName);
    tfEnv[`TF_VAR_db_${suffix}_password`] = password;
  }

  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: outputDir,
    env: tfEnv,
  });

  if (!initResult.success) {
    throw new CliError(
      'Initialization failed',
      'infra:deploy',
      initResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.info('Planning changes...');
  logger.newline();

  const planResult = await executeTerraform('plan', {
    workDir: outputDir,
    env: tfEnv,
  });

  if (!planResult.success) {
    throw new CliError(
      'Planning failed',
      'infra:deploy',
      planResult.error || 'Check the output above for details',
    );
  }

  logger.newline();

  // Confirm
  if (!options.autoApprove && !ctx.runningInCI) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Do you want to apply these changes?',
        default: false,
      },
    ]);

    if (!confirm) {
      logger.warn('Deployment cancelled by user');
      return;
    }
  }

  logger.newline();
  logger.info('Applying changes...');
  logger.newline();

  const applyResult = await executeTerraform('apply', {
    workDir: outputDir,
    autoApprove: true,
    env: tfEnv,
  });

  if (!applyResult.success) {
    throw new CliError(
      'Deployment failed',
      'infra:deploy',
      applyResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.success('Infrastructure deployed successfully!');
  logger.newline();

  // Sync DATABASE_URL per service
  if (servicesWithDb.length > 0) {
    logger.info('Syncing DATABASE_URL secrets to Secret Manager...');

    try {
      const dbHost = getTerraformOutput(
        outputDir,
        'database_private_ip',
        tfEnv,
      );

      for (const service of servicesWithDb) {
        const password = dbPasswords[service.name];
        if (!password) {
          logger.warn(
            `  ⚠ No password for ${service.name}, skipping DATABASE_URL`,
          );
          continue;
        }

        const encodedPassword = encodeURIComponent(password);
        const databaseUrl = `postgresql://${service.name}:${encodedPassword}@${dbHost}:5432/${service.name}`;

        setSecretViaCli(
          'DATABASE_URL',
          databaseUrl,
          ctx.targetEnv,
          service.name,
        );
        logger.success(`  ✓ DATABASE_URL for ${service.name}`);
      }

      logger.newline();
      logger.complete('DATABASE_URL secrets synced to Secret Manager');
    } catch (error) {
      logger.newline();
      logger.warn('Failed to sync DATABASE_URL secrets automatically');
      logger.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      logger.info('Run manually with:');
      logger.info(
        `  npx tsdevstack cloud-secrets:set DATABASE_URL --value <url> --env ${ctx.targetEnv} --service <service>`,
      );
    }
    logger.newline();
  }

  // Sync Redis secrets to Secret Manager
  logger.info('Syncing Redis secrets to Secret Manager...');

  try {
    const redisHost = getTerraformOutput(outputDir, 'redis_host', tfEnv);
    const redisPort = getTerraformOutput(outputDir, 'redis_port', tfEnv);
    const redisAuthString = getTerraformOutput(
      outputDir,
      'redis_auth_string',
      tfEnv,
    );

    setSecretViaCli('REDIS_HOST', redisHost, ctx.targetEnv);
    logger.success('  REDIS_HOST');

    setSecretViaCli('REDIS_PORT', redisPort, ctx.targetEnv);
    logger.success('  REDIS_PORT');

    setSecretViaCli('REDIS_PASSWORD', redisAuthString, ctx.targetEnv);
    logger.success('  REDIS_PASSWORD');

    // GCP Memorystore (basic tier) does not support TLS
    // Explicitly set to 'false' to ensure clean state if switching from AWS
    setSecretViaCli('REDIS_TLS', 'false', ctx.targetEnv);
    logger.success('  REDIS_TLS');

    logger.newline();
    logger.complete('Redis secrets synced to Secret Manager');
  } catch (error) {
    logger.newline();
    logger.warn('Failed to sync Redis secrets automatically');
    logger.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    logger.info('Run manually:');
    logger.info(`  terraform -chdir="${outputDir}" output -raw redis_host`);
    logger.info(`  terraform -chdir="${outputDir}" output -raw redis_port`);
    logger.info(
      `  terraform -chdir="${outputDir}" output -raw redis_auth_string`,
    );
    logger.info('Then set each with:');
    logger.info(
      `  npx tsdevstack cloud-secrets:set REDIS_HOST --value <host> --env ${ctx.targetEnv} --overwrite`,
    );
    logger.info(
      `  npx tsdevstack cloud-secrets:set REDIS_PORT --value <port> --env ${ctx.targetEnv} --overwrite`,
    );
    logger.info(
      `  npx tsdevstack cloud-secrets:set REDIS_PASSWORD --value <auth_string> --env ${ctx.targetEnv} --overwrite`,
    );
  }

  // Sync storage bucket secrets to Secret Manager
  const frameworkConfig = loadFrameworkConfig();

  if (frameworkConfig.storage?.buckets?.length) {
    logger.newline();
    logger.info('Syncing storage bucket secrets to Secret Manager...');

    try {
      const storageBuckets = getTerraformOutputJson<
        Record<string, { name: string }>
      >(outputDir, 'storage_buckets', tfEnv);

      for (const bucket of frameworkConfig.storage.buckets) {
        const secretKey = `STORAGE_BUCKET_${bucket.replace(/-/g, '_').toUpperCase()}`;
        const bucketName = storageBuckets[bucket].name;
        setSecretViaCli(secretKey, bucketName, ctx.targetEnv);
        logger.success(`  ✓ ${secretKey}`);
      }

      logger.newline();
      logger.complete('Storage bucket secrets synced to Secret Manager');
    } catch (error) {
      logger.newline();
      logger.warn('Failed to sync storage bucket secrets automatically');
      logger.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      logger.info('Run manually:');
      logger.info(
        `  terraform -chdir="${outputDir}" output -json storage_buckets`,
      );
      logger.info('Then set each with:');
      logger.info(
        `  npx tsdevstack cloud-secrets:set STORAGE_BUCKET_<NAME> --value <bucket> --env ${ctx.targetEnv} --overwrite`,
      );
    }
  }

  // Sync deterministic service URLs to Secret Manager
  // Cloud Run URLs are deterministic: https://{service}-{projectNumber}.{region}.run.app
  logger.newline();
  logger.info('Syncing service URLs to Secret Manager...');

  try {
    const projectNumber = getTerraformOutput(
      outputDir,
      'project_number',
      tfEnv,
    );

    for (const service of frameworkConfig.services) {
      if (!service.port) continue;
      const urlKey = `${service.name.replace(/-/g, '_').toUpperCase()}_URL`;
      const url = `https://${service.name}-${projectNumber}.${ctx.credentials.region}.run.app`;
      setSecretViaCli(urlKey, url, ctx.targetEnv);
      logger.success(`  ✓ ${urlKey} = ${url}`);
    }

    // Kong Gateway URL follows the same predictable pattern
    const kongUrl = `https://${ctx.projectName}-kong-${projectNumber}.${ctx.credentials.region}.run.app`;
    setSecretViaCli('KONG_INTERNAL_URL', kongUrl, ctx.targetEnv);
    logger.success(`  ✓ KONG_INTERNAL_URL = ${kongUrl}`);

    logger.newline();
    logger.complete('Service URLs synced to Secret Manager');
  } catch (error) {
    logger.newline();
    logger.warn('Failed to sync service URLs automatically');
    logger.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Skip service deployment phases if --infra-only flag is set
  if (options.infraOnly) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.complete('Infrastructure provisioning complete!');
    logger.info('════════════════════════════════════════════');
    logger.newline();
    logger.info('Skipped: Service deployment, Kong Gateway');
    logger.info(
      'Run npx tsdevstack infra:deploy-services --env ' +
        ctx.targetEnv +
        ' to deploy services',
    );
    logger.newline();
    return;
  }

  // ============================================
  // Phase 2: Deploy Services to Cloud Run
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info('Phase 2: Deploying Services to Cloud Run...');
  logger.info('════════════════════════════════════════════');

  await infraDeployServices({ env: ctx.targetEnv, tag: options.tag });

  // Set scheduler IAM bindings (services now exist)
  if (scheduledJobs.length > 0) {
    const targetServices = Array.from(
      new Set(scheduledJobs.map((j) => j.targetService)),
    );
    logger.newline();
    logger.info('Setting scheduler IAM bindings...');
    await setSchedulerInvokerBindings(runtime, {
      projectId: ctx.credentials.project_id,
      projectName: ctx.projectName,
      region: ctx.credentials.region,
      targetServices,
      credentials: ctx.credentials,
    });
  }

  // ============================================
  // Phase 3: Deploy Kong Gateway
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info('Phase 3: Deploying Kong Gateway...');
  logger.info('════════════════════════════════════════════');

  // Generate Kong config
  await infraKongGenerate({ env: ctx.targetEnv });

  // Build Kong image
  await infraKongBuild({ env: ctx.targetEnv, tag: options.tag });

  await infraKongDeploy({ env: ctx.targetEnv, tag: options.tag });

  // ============================================
  // Complete!
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.complete('Full infrastructure deployment complete!');
  logger.info('════════════════════════════════════════════');
  logger.newline();
}
