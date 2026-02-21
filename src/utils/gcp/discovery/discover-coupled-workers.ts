/**
 * Discover Coupled Workers
 *
 * Finds workers that are coupled to a base service by querying Cloud Run.
 * Workers are identified by:
 * 1. Name ends with "-worker"
 * 2. Uses the same service account as the base service
 */

import { getContext } from '../../../context';
import { listCloudRunServices } from './list-cloud-run-services';

export interface CoupledWorkerInfo {
  name: string;
}

export interface DiscoverCoupledWorkersOptions {
  baseServiceName: string;
  baseServiceAccount: string;
  projectId: string;
  region: string;
  credentials: Parameters<typeof listCloudRunServices>[0]['credentials'];
}

/**
 * Discover coupled workers that share the same service account as the base service
 */
export async function discoverCoupledWorkers(
  options: DiscoverCoupledWorkersOptions
): Promise<CoupledWorkerInfo[]> {
  const { logger } = getContext();

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
    // Skip if not a worker
    if (!service.name.endsWith('-worker')) {
      continue;
    }

    // Skip if it's the base service itself (shouldn't happen, but safety check)
    if (service.name === options.baseServiceName) {
      continue;
    }

    // Check if it uses the same service account as the base service
    if (service.serviceAccount === options.baseServiceAccount) {
      coupledWorkers.push({ name: service.name });
    }
  }

  return coupledWorkers;
}