/**
 * Discover Coupled Workers
 *
 * Finds the deployed workers of a base service, like AWS and Azure do:
 * 1. Workers in config.json whose baseService is the service (any name)
 * 2. Cloud Run services named "*-worker" that run as the base service's
 *    account (a worker already unregistered from config.json)
 */

import type { NamingScheme } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { listCloudRunServices } from './list-cloud-run-services';
import { getGcpProjectServiceName } from '../get-gcp-project-service-name';

export interface CoupledWorkerInfo {
  /** Worker name (as in config.json) */
  name: string;
  /** Its Cloud Run service name */
  cloudRunName: string;
}

export interface DiscoverCoupledWorkersOptions {
  projectName: string;
  /** The environment's naming scheme */
  naming: NamingScheme;
  baseServiceName: string;
  baseServiceAccount: string;
  projectId: string;
  region: string;
  credentials: Parameters<typeof listCloudRunServices>[0]['credentials'];
}

/**
 * Discover the deployed workers of a base service
 */
export async function discoverCoupledWorkers(
  options: DiscoverCoupledWorkersOptions,
): Promise<CoupledWorkerInfo[]> {
  const { logger, loadFrameworkConfig } = getContext();

  let configWorkers: string[] = [];
  try {
    configWorkers = loadFrameworkConfig()
      .services.filter(
        (s) => s.type === 'worker' && s.baseService === options.baseServiceName,
      )
      .map((s) => s.name);
  } catch {
    // No readable config.json: the Cloud Run heuristic below still runs
  }

  // List all Cloud Run services
  const result = await listCloudRunServices({
    projectId: options.projectId,
    region: options.region,
    credentials: options.credentials,
  });

  if (!result.success) {
    logger.warn(`Could not list Cloud Run services: ${result.error}`);
    return [];
  }

  // Filter for workers that share the same service account
  const coupledWorkers: CoupledWorkerInfo[] = [];

  for (const service of result.services) {
    // The worker's name in config.json; undefined for another project's
    const name = getGcpProjectServiceName(
      options.projectName,
      service,
      options.naming,
    );
    // Skip the base service itself
    if (name === undefined || name === options.baseServiceName) {
      continue;
    }

    // Registered in config.json with this base service, whatever its name
    const inConfig = configWorkers.includes(name);
    // Or named like a worker and running as the base service's account
    const byNameAndAccount =
      name.endsWith('-worker') &&
      service.serviceAccount === options.baseServiceAccount;

    if (inConfig || byNameAndAccount) {
      coupledWorkers.push({ name, cloudRunName: service.name });
    }
  }

  return coupledWorkers;
}
