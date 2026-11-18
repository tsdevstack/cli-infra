/**
 * Execute Container Apps Job
 *
 * Runs a one-off Container Apps Job (Azure equivalent of ECS RunTask).
 * Used for database migrations and other one-off commands.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { pollContainerJobStatus } from './poll-container-job-status';
import { findLatestJobExecution } from './find-latest-job-execution';
import { waitForJobExecution } from './wait-for-job-execution';
import { buildRuntime } from '../../build-runtime';
import { AZURE_JOB_START_MARGIN_SECONDS } from '../../../constants';
import {
  createAzureCredential,
  buildAcrAuthConfig,
} from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

export interface ExecuteContainerJobOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  containerAppsEnvId: string;
  jobName: string;
  image: string;
  command: string[];
  envVars?: Array<{ name: string; value: string }>;
  /**
   * Env vars Container Apps fetches from Key Vault (keyVaultUrl: the
   * secret's URL) with secretsIdentityId, so no value is in the job's settings
   */
  keyVaultEnvVars?: Array<{ name: string; keyVaultUrl: string }>;
  /**
   * Identity (resource ID) that reads keyVaultEnvVars, attached to the job
   * for Container Apps only: the code in the container can't get its tokens
   */
  secretsIdentityId?: string;
  /** ACR login server for private registry auth (e.g., 'myacr.azurecr.io') */
  acrLoginServer?: string;
  /** User-assigned managed identity resource ID for ACR pull (preferred over password auth) */
  acrManagedIdentityId?: string;
  /** Timeout in seconds (default: 300) */
  timeoutSeconds?: number;
  /** CPU allocation as number (default: 1) */
  cpu?: number;
  /** Memory allocation (default: '2Gi') */
  memory?: string;
}

export interface ExecuteContainerJobResult {
  success: boolean;
  logs: string;
  error?: string;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 5_000;

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

function isTransientError(err: unknown): boolean {
  const message = (err as { message?: string })?.message ?? '';
  return (
    message.includes('network_error') ||
    message.includes('Network request failed') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNRESET')
  );
}

function createClient(credentials: AzureCredentials): ContainerAppsAPIClient {
  const credential = createAzureCredential(buildRuntime(), credentials);
  return new ContainerAppsAPIClient(credential, credentials.subscriptionId);
}

export async function executeContainerJob(
  options: ExecuteContainerJobOptions,
): Promise<ExecuteContainerJobResult> {
  const {
    credentials,
    resourceGroupName,
    containerAppsEnvId,
    jobName,
    image,
    command,
    envVars = [],
    keyVaultEnvVars = [],
    secretsIdentityId,
    acrLoginServer,
    timeoutSeconds = 300,
  } = options;

  if (keyVaultEnvVars.length > 0 && !secretsIdentityId) {
    return {
      success: false,
      logs: '',
      error: 'Key Vault env vars need secretsIdentityId to be read with',
    };
  }

  let client = createClient(credentials);

  // ACR registry auth: prefer managed identity, fall back to password
  const acrAuth = await buildAcrAuthConfig({
    acrLoginServer,
    acrManagedIdentityId: options.acrManagedIdentityId,
    credentials,
  });
  const { registries } = acrAuth;

  // Container Apps secret names: lowercase letters, digits and hyphens
  const keyVaultSecrets = keyVaultEnvVars.map((e) => ({
    envName: e.name,
    secret: {
      name: e.name.toLowerCase().replace(/_/g, '-'),
      keyVaultUrl: e.keyVaultUrl,
      identity: secretsIdentityId,
    },
  }));
  const allSecrets = [
    ...acrAuth.secrets,
    ...keyVaultSecrets.map((s) => s.secret),
  ];
  const secrets = allSecrets.length > 0 ? allSecrets : undefined;
  const env = [
    ...envVars,
    ...keyVaultSecrets.map((s) => ({
      name: s.envName,
      secretRef: s.secret.name,
    })),
  ];

  // The secrets identity joins the ACR one
  const identity = secretsIdentityId
    ? {
        type: 'UserAssigned' as const,
        userAssignedIdentities: {
          ...(acrAuth.identity?.userAssignedIdentities ?? {}),
          [secretsIdentityId]: {},
        },
      }
    : acrAuth.identity;

  const jobDefinition = {
    location: credentials.location,
    environmentId: containerAppsEnvId,
    identity,
    configuration: {
      triggerType: 'Manual' as const,
      replicaTimeout: timeoutSeconds,
      replicaRetryLimit: 0,
      secrets,
      registries,
      // Container Apps reads the Key Vault secrets with it; the code in the
      // container can't use it (an identity is open to it by default)
      identitySettings: secretsIdentityId
        ? [{ identity: secretsIdentityId, lifecycle: 'None' as const }]
        : undefined,
    },
    template: {
      containers: [
        {
          name: jobName,
          image,
          command,
          resources: { cpu: options.cpu ?? 1, memory: options.memory ?? '2Gi' },
          env: env.length > 0 ? env : undefined,
        },
      ],
    },
  };

  // Step 1: Create or update the job (with retry on transient network errors)
  // Fresh SDK client on each retry to avoid stale HTTP connections.
  let lastCreateError: unknown;
  let createSucceeded = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.jobs.beginCreateOrUpdateAndWait(
        resourceGroupName,
        jobName,
        jobDefinition,
      );
      createSucceeded = true;
      break;
    } catch (err: unknown) {
      lastCreateError = err;
      if (isTransientError(err) && attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_MS * attempt),
        );
        client = createClient(credentials);
        continue;
      }
      break;
    }
  }

  if (!createSucceeded) {
    return {
      success: false,
      logs: '',
      error: extractErrorMessage(
        lastCreateError,
        'Unknown error creating Container Apps Job',
      ),
    };
  }

  // Step 2: Start one execution, then wait for it to finish. Only the start
  // request is sent again after a network error: once an execution runs,
  // another start would run the job twice (two restores of one database at
  // once). The newest execution before this start is noted first, so the
  // fallback below never takes it for this one.
  let previousExecution: string | null | undefined;
  try {
    previousExecution =
      (await findLatestJobExecution(client, resourceGroupName, jobName))
        ?.name ?? null;
  } catch {
    previousExecution = undefined;
  }

  let lastStartError: unknown;
  let started: ReturnType<typeof client.jobs.start> | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const poller = client.jobs.start(resourceGroupName, jobName, {});
      await poller.submitted();
      started = poller;
      break;
    } catch (err: unknown) {
      lastStartError = err;
      if (isTransientError(err) && attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_MS * attempt),
        );
        client = createClient(credentials);
        continue;
      }
      if (!isTransientError(err)) {
        // Refused: no execution started
        return {
          success: false,
          logs: '',
          error: extractErrorMessage(
            err,
            'Unknown error starting Container Apps Job',
          ),
        };
      }
      break;
    }
  }

  // The start ends once the execution exists, not when it has run (its
  // answer is the execution's name): whether the job worked is the
  // execution's own status
  let executionName: string | undefined;
  if (started) {
    try {
      executionName = (await started.pollUntilDone()).name;
    } catch (err: unknown) {
      lastStartError = err;
    }
  }

  if (executionName) {
    try {
      const end = await waitForJobExecution(
        client,
        resourceGroupName,
        jobName,
        executionName,
        timeoutSeconds + AZURE_JOB_START_MARGIN_SECONDS,
      );
      if (end.status === 'Succeeded') {
        return { success: true, logs: 'Job completed successfully' };
      }
      return {
        success: false,
        logs: '',
        error: `Job execution ${executionName}: ${end.status}${end.detail ? ` (${end.detail})` : ''}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        logs: '',
        error: `Could not read the status of job execution ${executionName}: ${extractErrorMessage(err, 'unknown error')}`,
      };
    }
  }

  // The start's answer or the wait was lost: the newest execution's status
  try {
    const result = await pollContainerJobStatus(
      client,
      resourceGroupName,
      jobName,
      timeoutSeconds + AZURE_JOB_START_MARGIN_SECONDS,
      previousExecution,
    );

    if (result.status === 'Succeeded') {
      return {
        success: true,
        logs: 'Job completed successfully (recovered from polling error)',
      };
    }

    return {
      success: false,
      logs: '',
      error: `Job execution status: ${result.status}`,
    };
  } catch {
    return {
      success: false,
      logs: '',
      error: extractErrorMessage(
        lastStartError,
        'Unknown error starting Container Apps Job',
      ),
    };
  }
}
