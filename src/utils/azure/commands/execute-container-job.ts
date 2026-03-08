/**
 * Execute Container Apps Job
 *
 * Runs a one-off Container Apps Job (Azure equivalent of ECS RunTask).
 * Used for database migrations and other one-off commands.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { pollContainerJobStatus } from './poll-container-job-status';
import { buildRuntime } from '../../build-runtime';
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
    acrLoginServer,
    timeoutSeconds = 300,
  } = options;

  let client = createClient(credentials);

  // ACR registry auth: prefer managed identity, fall back to password
  const acrAuth = await buildAcrAuthConfig({
    acrLoginServer,
    acrManagedIdentityId: options.acrManagedIdentityId,
    credentials,
  });
  const { registries, identity } = acrAuth;
  const secrets = acrAuth.secrets.length > 0 ? acrAuth.secrets : undefined;

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
    },
    template: {
      containers: [
        {
          name: jobName,
          image,
          command,
          resources: { cpu: options.cpu ?? 1, memory: options.memory ?? '2Gi' },
          env: envVars.length > 0 ? envVars : undefined,
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

  // Step 2: Start the job execution and wait for completion
  // beginStartAndWait is an LRO that polls until the execution finishes.
  // The LRO poller can fail with transient network errors even when the
  // job itself succeeds. Retry with fresh client, then fall back to polling.
  let lastStartError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.jobs.beginStartAndWait(resourceGroupName, jobName, {});
      return { success: true, logs: 'Job completed successfully' };
    } catch (err: unknown) {
      lastStartError = err;
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

  // All retries failed — fall back to polling execution status
  try {
    const result = await pollContainerJobStatus(
      client,
      resourceGroupName,
      jobName,
      timeoutSeconds,
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
