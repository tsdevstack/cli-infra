/**
 * Discover Coupled Workers (AWS)
 *
 * Finds workers that are coupled to a base service.
 * Returns only workers that actually exist in ECS.
 */

import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { getEcsService } from './get-ecs-service';

export interface DiscoverCoupledWorkersOptions {
  serviceName: string;
  projectName: string;
  targetEnv: string;
  credentials: AWSCredentials;
}

/**
 * Discover workers coupled to a service
 */
export async function discoverCoupledWorkers(
  options: DiscoverCoupledWorkersOptions,
): Promise<string[]> {
  const { serviceName, projectName, credentials } = options;
  const { loadFrameworkConfig } = getContext();

  let config;
  try {
    config = loadFrameworkConfig();
  } catch {
    // Config might not exist or be invalid
    return [];
  }

  // Find workers that reference this service as baseService
  const coupledWorkers = config.services.filter(
    (s) => s.type === 'worker' && s.baseService === serviceName,
  );

  if (coupledWorkers.length === 0) {
    return [];
  }

  // Check which workers actually exist in ECS
  const existingWorkers: string[] = [];
  const clusterName = `${projectName}-cluster`;

  for (const worker of coupledWorkers) {
    const result = await getEcsService({
      clusterName,
      serviceName: worker.name,
      credentials,
    });

    if (result.service.exists) {
      existingWorkers.push(worker.name);
    }
  }

  return existingWorkers;
}
