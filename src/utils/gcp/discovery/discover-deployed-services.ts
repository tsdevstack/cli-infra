/**
 * Discover Deployed Services
 *
 * Orchestrates discovery of ALL deployed services in an environment.
 * Combines Cloud Run services and SPA buckets to get complete picture.
 *
 * Cloud is the source of truth - this allows listing services even if
 * config.json is out of sync with actual deployments.
 */

import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import type {
  DeployedServiceInfo,
  DiscoverDeployedServicesResult,
} from '../../discovery/types';
import { listCloudRunServices } from './list-cloud-run-services';
import { listSpaBuckets } from './list-spa-buckets';
import { discoverServiceResources } from './discover-service-resources';

export type { DeployedServiceInfo, DiscoverDeployedServicesResult };

export interface DiscoverDeployedServicesOptions {
  projectName: string;
  projectId: string;
  region: string;
  sqlInstanceName: string;
  credentials: GCPCredentials;
}

/**
 * Discover all deployed services in an environment
 *
 * Lists Cloud Run services and SPA buckets, then enriches with full resource details.
 *
 * @param options - Project details and credentials
 * @returns List of all deployed services with their resources
 */
export async function discoverDeployedServices(
  options: DiscoverDeployedServicesOptions,
): Promise<DiscoverDeployedServicesResult> {
  const { projectName, projectId, region, sqlInstanceName, credentials } =
    options;

  // Step 1: List Cloud Run services and SPA buckets in parallel
  const [cloudRunResult, spaBucketsResult] = await Promise.all([
    listCloudRunServices({
      projectId,
      region,
      credentials,
    }),
    listSpaBuckets({
      projectName,
      projectId,
      credentials,
    }),
  ]);

  if (!cloudRunResult.success) {
    return {
      success: false,
      services: [],
      error: `Failed to list Cloud Run services: ${cloudRunResult.error}`,
    };
  }

  if (!spaBucketsResult.success) {
    return {
      success: false,
      services: [],
      error: `Failed to list SPA buckets: ${spaBucketsResult.error}`,
    };
  }

  // Step 2: Collect unique service names
  const serviceNames = new Set<string>();

  // Add Cloud Run services (these are typically nestjs/nextjs)
  for (const service of cloudRunResult.services) {
    // Skip Kong gateway
    if (service.name === `${projectName}-kong`) {
      continue;
    }
    serviceNames.add(service.name);
  }

  // Add SPA services (bucket-based)
  for (const bucket of spaBucketsResult.buckets) {
    serviceNames.add(bucket.serviceName);
  }

  // Step 3: Get full details for each service in parallel
  const detailPromises = Array.from(serviceNames).map(async (serviceName) => {
    const discovered = await discoverServiceResources({
      serviceName,
      projectName,
      projectId,
      region,
      sqlInstanceName,
      credentials,
    });

    // Find URL from Cloud Run results
    const cloudRunService = cloudRunResult.services.find(
      (s) => s.name === serviceName,
    );

    // SPA services don't have Cloud Run status/image
    const status =
      cloudRunService?.status ??
      (discovered.spaBucket ? 'DEPLOYED' : 'UNKNOWN');
    const imageUri = cloudRunService?.imageUri;

    return {
      name: serviceName,
      type: discovered.inferredType,
      status,
      url: cloudRunService?.url ?? discovered.cloudRunServiceUrl,
      imageUri,
      resources: {
        cloudRunService: discovered.cloudRunService,
        spaBucket: discovered.spaBucket,
        hasDatabase: discovered.hasDatabase,
        secretCount: discovered.secrets.length,
        hasServiceAccount: discovered.serviceAccount,
      },
    } satisfies DeployedServiceInfo;
  });

  const services = await Promise.all(detailPromises);

  // Sort by name for consistent output
  services.sort((a, b) => a.name.localeCompare(b.name));

  return {
    success: true,
    services,
  };
}
