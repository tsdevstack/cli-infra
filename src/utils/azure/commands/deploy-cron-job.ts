/**
 * Deploy one cron job to Azure: a Container App Job with a schedule trigger
 * that runs the service's image as `node dist/cron.js <name>`, one replica,
 * no retries, stopped at the job's timeout. SDK-managed (A4): created or
 * updated here, by deploy-services with the service's new image and by
 * deploy-schedulers with the image the service runs.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import {
  buildAcrAuthConfig,
  createAzureCredential,
  CRON_JOB_COMMAND,
  type CronJobConfig,
} from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';
import {
  AZURE_CRON_JOB_NAME_TAG,
  AZURE_CRON_JOB_SERVICE_TAG,
} from '../../../constants';
import { buildAzureCronJobName } from '../naming/build-azure-cron-job-name';

export interface AzureDeployCronJobParams {
  projectName: string;
  credentials: AzureCredentials;
  resourceGroupName: string;
  containerAppsEnvId: string;
  job: CronJobConfig;
  /** The service's image (`{acr}/{service}:{tag}`) */
  image: string;
  envVars: Array<{ name: string; value: string }>;
  secrets: Array<{ name: string; value: string }>;
  secretEnvVars: Array<{ name: string; secretRef: string }>;
  cpu: number;
  memory: string;
  /**
   * replicaTimeout (buildAzureCronJobPlatformTimeout): the job's timeout, the
   * margin and the start allowance, so the runner's own timer always fires
   * first and the platform's kill only matters for a stuck process
   */
  platformTimeoutSeconds: number;
  acrLoginServer: string;
  acrManagedIdentityId?: string;
  /** The service's Key Vault identity (resource ID): the job reads its secrets with it */
  secretsIdentityId: string;
}

/**
 * @returns The Container App Job's name
 */
export async function azureDeployCronJob(
  params: AzureDeployCronJobParams,
): Promise<{ jobName: string }> {
  const { credentials, job } = params;
  const jobName = buildAzureCronJobName(params.projectName, job.name);

  const client = new ContainerAppsAPIClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );

  // Registry auth as the Container Apps have it; the secrets identity joins
  // the ACR one, so the code can read Key Vault with it (SecretsModule)
  const acrAuth = await buildAcrAuthConfig({
    acrLoginServer: params.acrLoginServer,
    acrManagedIdentityId: params.acrManagedIdentityId,
    credentials,
  });
  const identity = {
    type: 'UserAssigned' as const,
    userAssignedIdentities: {
      ...(acrAuth.identity?.userAssignedIdentities ?? {}),
      [params.secretsIdentityId]: {},
    },
  };
  const secrets = [...acrAuth.secrets, ...params.secrets];

  await client.jobs.beginCreateOrUpdateAndWait(
    params.resourceGroupName,
    jobName,
    {
      location: credentials.location,
      environmentId: params.containerAppsEnvId,
      identity,
      tags: {
        [AZURE_CRON_JOB_SERVICE_TAG]: job.targetService,
        [AZURE_CRON_JOB_NAME_TAG]: job.name,
      },
      configuration: {
        triggerType: 'Schedule',
        replicaTimeout: params.platformTimeoutSeconds,
        replicaRetryLimit: 0,
        scheduleTriggerConfig: {
          cronExpression: job.schedule,
          parallelism: 1,
          replicaCompletionCount: 1,
        },
        secrets: secrets.length > 0 ? secrets : undefined,
        registries: acrAuth.registries,
      },
      template: {
        containers: [
          {
            name: jobName,
            image: params.image,
            command: [...CRON_JOB_COMMAND, job.name],
            resources: { cpu: params.cpu, memory: params.memory },
            env: [...params.envVars, ...params.secretEnvVars],
          },
        ],
      },
    },
  );

  return { jobName };
}
