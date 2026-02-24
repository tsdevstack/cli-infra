/**
 * Discover Coupled Workers (Azure)
 *
 * Finds workers coupled to a base service by reading config.json
 * and verifying each exists as a Container App in Azure.
 * These need to be deleted when the base service is removed, because
 * they won't function without the shared identity/secrets.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

export interface DiscoverCoupledWorkersOptions {
  baseServiceName: string;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}

export interface CoupledWorkerInfo {
  name: string;
  containerAppName: string;
}

/**
 * Discover workers coupled to a service
 *
 * Reads config to find workers with baseService matching the given service,
 * then verifies each exists as a Container App in Azure.
 */
export async function discoverCoupledWorkers(
  options: DiscoverCoupledWorkersOptions,
): Promise<CoupledWorkerInfo[]> {
  const { baseServiceName, projectName, targetEnv, credentials } = options;
  const { loadFrameworkConfig } = getContext();

  let config;
  try {
    config = loadFrameworkConfig();
  } catch {
    return [];
  }

  const coupledWorkers = config.services.filter(
    (s) => s.type === 'worker' && s.baseService === baseServiceName,
  );

  if (coupledWorkers.length === 0) return [];

  const resourceGroupName = `${projectName}-${targetEnv}-rg`;
  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);
  const client = new ContainerAppsAPIClient(
    credential,
    credentials.subscriptionId,
  );

  const existingWorkers: CoupledWorkerInfo[] = [];

  for (const worker of coupledWorkers) {
    const containerAppName = `${projectName}-${worker.name}`;
    try {
      await client.containerApps.get(resourceGroupName, containerAppName);
      existingWorkers.push({ name: worker.name, containerAppName });
    } catch {
      // Worker doesn't exist in Azure, skip it
    }
  }

  return existingWorkers;
}
