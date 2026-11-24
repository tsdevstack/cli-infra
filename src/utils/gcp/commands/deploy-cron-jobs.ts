/**
 * Deploy cron jobs to Cloud Run Jobs, one per entry, each with its service's
 * image, account and secrets. With an image tag (deploy-services, right after
 * the service) the job gets `{registry}/{service}:{tag}`; without one
 * (deploy-schedulers) it gets the image the service's Cloud Run service
 * runs, and a service that was never deployed stops the command with the
 * hint services get.
 *
 * Every path that creates a cron job's Cloud Run Job comes through here, so
 * this is where Cloud Scheduler's account gets run.invoker on it: the
 * schedule starts the job as that account. The account comes with the
 * schedules (cloud-scheduler.tf); before any were deployed it doesn't exist,
 * and the deploy says to run infra:deploy-schedulers.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import {
  buildGcpCloudRunName,
  buildGcpSchedulerAccountEmail,
  buildGcpTerraformEnv,
  calculatePoolSize,
  CRON_JOB_TIMEOUT,
  getTotalWorkerMaxInstances,
  setSchedulerInvokerBindings,
  type CronJobConfig,
  type NamingScheme,
} from '@tsdevstack/infra-core';
import type { FrameworkConfig } from '@tsdevstack/cli/plugin';
import { MIGRATION_JOB_DEFAULTS_GCP } from '../../../constants';
import { buildRuntime } from '../../build-runtime';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { warnIfSmallDatabasePool } from '../../deploy/warn-if-small-database-pool';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/get-service-config';
import { getTraceSampleRate } from '../../infrastructure/get-trace-sample-rate';
import type { EnvironmentOverrides } from '../../infrastructure/types';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import { serviceAccountExists } from '../discovery/service-account-exists';
import { gcpDeployCronJob } from './deploy-cron-job';
import { getDeployedCloudRunImage } from './get-deployed-cloud-run-image';
import type { GCPCommandContext } from './types';

export interface GcpDeployCronJobsOptions {
  /** The environment's naming scheme */
  naming: NamingScheme;
  /** The tag just deployed; left out, the service's deployed image is used */
  imageTag?: string;
  /** The command, for the errors */
  commandName: string;
}

export async function gcpDeployCronJobs(
  ctx: GCPCommandContext,
  config: FrameworkConfig,
  jobs: CronJobConfig[],
  options: GcpDeployCronJobsOptions,
): Promise<void> {
  const { logger, CliError, DEFAULT_DATABASE_TIER } = getContext();
  if (jobs.length === 0) return;

  const { projectRoot, projectName, targetEnv, credentials } = ctx;
  const { naming } = options;
  const runtime = buildRuntime();
  const tfEnv = buildGcpTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let registryUrl: string;
  let vpcNetwork: string;
  let vpcSubnet: string;
  let serviceAccountEmails: Record<string, string>;
  try {
    registryUrl = getTerraformOutput(
      terraformDir,
      'artifact_registry_url',
      tfEnv,
    );
    vpcNetwork = getTerraformOutput(terraformDir, 'vpc_id', tfEnv);
    vpcSubnet = getTerraformOutput(terraformDir, 'subnet_id', tfEnv);
    serviceAccountEmails = getTerraformOutputJson<Record<string, string>>(
      terraformDir,
      'runtime_service_account_emails',
      tfEnv,
    );
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      options.commandName,
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // A run connects as its service does: the service's pool size (A7: cron
  // jobs are not counted, they draw on the reserve)
  const infraConfig = loadInfrastructureConfig();
  const envConfig = infraConfig?.[targetEnv] as
    EnvironmentOverrides | undefined;
  const dbTier = envConfig?.database?.tier ?? DEFAULT_DATABASE_TIER;
  const pool = calculatePoolSize({
    dbTier,
    provider: 'gcp',
    totalServiceMaxInstances: getTotalServiceMaxInstances(
      config.services,
      infraConfig,
      targetEnv,
      'gcp',
    ),
    totalWorkerMaxInstances: getTotalWorkerMaxInstances(config.services, {
      infraConfig,
      targetEnv,
    }),
  });
  warnIfSmallDatabasePool(pool, dbTier);

  logger.newline();
  logger.info(`Deploying ${jobs.length} cron job(s) to Cloud Run Jobs...`);

  // The schedules start the jobs as the scheduler account. When it surely
  // doesn't exist yet, the grant waits for infra:deploy-schedulers; when the
  // check itself fails, the grant is tried (and warns if it fails)
  const schedulerAccountEmail = buildGcpSchedulerAccountEmail(
    projectName,
    credentials.project_id,
  );
  const schedulerAccount = await serviceAccountExists({
    serviceAccountEmail: schedulerAccountEmail,
    projectId: credentials.project_id,
    credentials,
  });
  const schedulerAccountMissing =
    !schedulerAccount.exists && !schedulerAccount.error;
  const notStartable: string[] = [];

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

    const serviceAccount = serviceAccountEmails[service.name];
    if (!serviceAccount) {
      failures.push({
        job: job.name,
        error: `No service account for ${service.name}: run infra:deploy`,
      });
      logger.error(
        `  ${job.name}: no service account for ${service.name} (run infra:deploy)`,
      );
      continue;
    }

    const imageUri = options.imageTag
      ? `${registryUrl}/${service.name}:${options.imageTag}`
      : await getDeployedCloudRunImage(
          credentials,
          buildGcpCloudRunName(projectName, service.name, naming),
        );
    if (!imageUri) {
      failures.push({
        job: job.name,
        error: `${service.name} is not deployed yet: npx tsdevstack infra:deploy-services --env ${targetEnv} --service ${service.name}`,
      });
      logger.error(
        `  ${job.name}: ${service.name} is not deployed yet, deploy the service first`,
      );
      continue;
    }

    const serviceConfig = getServiceConfig(
      infraConfig,
      service.name,
      targetEnv,
      'gcp',
    );

    try {
      const { jobName } = await gcpDeployCronJob({
        projectName,
        credentials,
        naming,
        job,
        service,
        imageUri,
        vpcNetwork,
        vpcSubnet,
        serviceAccount,
        poolMax: pool.poolMax,
        logLevel: serviceConfig.logLevel,
        traceSampleRate: getTraceSampleRate(infraConfig, targetEnv),
        cpu: job.cpu ?? MIGRATION_JOB_DEFAULTS_GCP.cpu,
        memory: job.memory ?? MIGRATION_JOB_DEFAULTS_GCP.memory,
        timeoutSeconds: job.timeout ?? CRON_JOB_TIMEOUT.gcp.default,
      });
      logger.success(
        `  ${job.name} deployed (${jobName}, ${job.schedule}, ${imageUri})`,
      );
      if (schedulerAccountMissing) {
        notStartable.push(job.name);
      } else {
        await setSchedulerInvokerBindings(runtime, {
          projectId: credentials.project_id,
          projectName,
          region: credentials.region,
          targetServices: [],
          targetJobs: [jobName],
          credentials,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      failures.push({ job: job.name, error: message });
      logger.error(`  ${job.name}: ${message}`);
    }
  }

  if (notStartable.length > 0) {
    logger.warn(
      `Cloud Scheduler can't start ${notStartable.join(', ')} yet: its account ${schedulerAccountEmail} doesn't exist`,
    );
    logger.info(
      `  Run npx tsdevstack infra:deploy-schedulers --env ${targetEnv}: it creates the account with the schedules and lets it start the jobs`,
    );
  }

  if (failures.length > 0) {
    throw new CliError(
      `Failed to deploy ${failures.length} cron job(s)`,
      options.commandName,
      failures.map((f) => `${f.job}: ${f.error}`).join('\n'),
    );
  }
}
