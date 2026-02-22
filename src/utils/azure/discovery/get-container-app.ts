/**
 * Get Container App
 *
 * Queries a single Azure Container App to check if it exists and get its status.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

export interface GetContainerAppOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  containerAppName: string;
}

export interface ContainerAppInfo {
  exists: boolean;
  status?: string;
  fqdn?: string;
  replicas?: number;
  image?: string;
}

export interface GetContainerAppResult {
  success: boolean;
  app: ContainerAppInfo;
  error?: string;
}

/**
 * Get status of a single Azure Container App
 */
export async function getContainerApp(
  options: GetContainerAppOptions,
): Promise<GetContainerAppResult> {
  const { credentials, resourceGroupName, containerAppName } = options;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new ContainerAppsAPIClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    const app = await client.containerApps.get(
      resourceGroupName,
      containerAppName,
    );

    const template = app.template;
    const containers = template?.containers ?? [];
    const firstContainer = containers[0];

    return {
      success: true,
      app: {
        exists: true,
        status: app.provisioningState ?? 'Unknown',
        fqdn: app.configuration?.ingress?.fqdn,
        replicas: template?.scale?.minReplicas ?? 0,
        image: firstContainer?.image,
      },
    };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };

    if (error.statusCode === 404) {
      return {
        success: true,
        app: { exists: false },
      };
    }

    return {
      success: false,
      app: { exists: false },
      error: error.message || 'Unknown error getting Container App',
    };
  }
}
