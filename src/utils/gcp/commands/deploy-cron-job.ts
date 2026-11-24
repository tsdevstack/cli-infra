/**
 * Deploy one cron job to GCP: a Cloud Run Job (`{project}-cron-{name}`) that
 * runs the service's image as `node dist/cron.js <name>`, one task, no
 * retries, the service's account and Direct VPC egress, stopped at the
 * job's timeout plus the platform margin. SDK-managed (A4), like the
 * migration jobs; its schedule is Terraform's (cloud-scheduler.tf).
 */

import {
  buildBackendEnvVars,
  buildBackendSecrets,
  createOrUpdateCloudRunJob,
  CRON_JOB_COMMAND,
  CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS,
  type CronJobConfig,
  type NamingScheme,
} from '@tsdevstack/infra-core';
import type { GCPCredentials, FrameworkService } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import {
  GCP_CRON_JOB_NAME_LABEL,
  GCP_CRON_JOB_SERVICE_LABEL,
} from '../../../constants';
import { buildGcpCronJobName } from '../build-gcp-cron-job-name';
import { buildGcpServiceLabels } from '../build-gcp-service-labels';

export interface GcpDeployCronJobParams {
  projectName: string;
  credentials: GCPCredentials;
  naming: NamingScheme;
  job: CronJobConfig;
  service: FrameworkService;
  /** The service's image (`{registry}/{service}:{tag}`) */
  imageUri: string;
  vpcNetwork: string;
  vpcSubnet: string;
  /** The service's runtime account: the job reads its secrets with it */
  serviceAccount: string;
  poolMax: number;
  logLevel?: string;
  traceSampleRate?: number;
  cpu: string;
  memory: string;
  /** The job's timeout (the runner's); the Cloud Run task gets it plus the margin */
  timeoutSeconds: number;
}

/**
 * @returns The Cloud Run Job's name
 */
export async function gcpDeployCronJob(
  params: GcpDeployCronJobParams,
): Promise<{ jobName: string }> {
  const { buildSecretName } = getContext();
  const { projectName, credentials, naming, job, service } = params;
  const jobName = buildGcpCronJobName(projectName, job.name, naming);

  const env = buildBackendEnvVars({
    provider: 'gcp',
    projectName,
    projectId: credentials.project_id,
    poolMax: params.poolMax,
    logLevel: params.logLevel,
    traceSampleRate: params.traceSampleRate,
    cronJob: { name: job.name, timeoutSeconds: params.timeoutSeconds },
  });
  const secretEnv = Object.fromEntries(
    buildBackendSecrets(
      projectName,
      service.name,
      service.hasDatabase ?? false,
      buildSecretName,
    ).map((secret) => [secret.envVar, secret.secretName]),
  );

  await createOrUpdateCloudRunJob(buildRuntime(), {
    projectId: credentials.project_id,
    region: credentials.region,
    jobName,
    imageUri: params.imageUri,
    command: [...CRON_JOB_COMMAND, job.name],
    vpcNetwork: params.vpcNetwork,
    vpcSubnet: params.vpcSubnet,
    env,
    secretEnv,
    serviceAccount: params.serviceAccount,
    credentials,
    cpu: params.cpu,
    memory: params.memory,
    timeoutSeconds:
      params.timeoutSeconds + CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS,
    labels: {
      ...buildGcpServiceLabels(projectName, naming),
      [GCP_CRON_JOB_SERVICE_LABEL]: service.name,
      [GCP_CRON_JOB_NAME_LABEL]: job.name,
    },
  });

  return { jobName };
}
