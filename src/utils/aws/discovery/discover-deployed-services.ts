/**
 * Discover Deployed Services (AWS)
 *
 * Orchestrates discovery of ALL deployed services in an AWS environment.
 * Combines ECS services, App Runner services, and S3 SPA buckets.
 *
 * Cloud is the source of truth - this allows listing services even if
 * config.json is out of sync with actual deployments.
 */

import { listEcsServices } from './list-ecs-services';
import { listAppRunnerServices } from './list-apprunner-services';
import { listSpaBuckets } from './list-spa-buckets';
import type { AWSCredentials } from 'tsdevstack/plugin';
import type {
  DeployedServiceInfo,
  DeployedServiceType,
  DiscoverDeployedServicesResult,
} from '../../discovery/types';

export type { DeployedServiceInfo, DiscoverDeployedServicesResult };

export interface DiscoverDeployedServicesOptions {
  projectName: string;
  credentials: AWSCredentials;
}

/**
 * Discover all deployed services in an AWS environment
 */
export async function discoverDeployedServices(
  options: DiscoverDeployedServicesOptions,
): Promise<DiscoverDeployedServicesResult> {
  const { projectName, credentials } = options;

  const clusterName = `${projectName}-cluster`;

  // List all service types in parallel
  const [ecsResult, appRunnerResult, spaResult] = await Promise.all([
    listEcsServices({ clusterName, credentials }),
    listAppRunnerServices({ projectName, credentials }),
    listSpaBuckets({ projectName, credentials }),
  ]);

  // Collect errors but continue with what we have
  const errors: string[] = [];
  if (!ecsResult.success) {
    errors.push(`ECS: ${ecsResult.error}`);
  }
  if (!appRunnerResult.success) {
    errors.push(`App Runner: ${appRunnerResult.error}`);
  }
  if (!spaResult.success) {
    errors.push(`S3: ${spaResult.error}`);
  }

  // If all failed, return error
  if (errors.length === 3) {
    return {
      success: false,
      services: [],
      error: errors.join('; '),
    };
  }

  const services: DeployedServiceInfo[] = [];

  // Add ECS services (backends, workers, kong)
  for (const service of ecsResult.services) {
    let type: DeployedServiceType = 'backend';
    if (service.serviceName === 'kong') {
      type = 'kong';
    } else if (service.serviceName.endsWith('-worker')) {
      type = 'worker';
    }

    services.push({
      name: service.serviceName,
      type,
      status: service.status,
      imageUri: service.imageUri,
      resources: {
        ecsService: true,
        appRunnerService: false,
        spaBucket: false,
        runningCount: service.runningCount,
        desiredCount: service.desiredCount,
      },
    });
  }

  // Add App Runner services (Next.js)
  for (const service of appRunnerResult.services) {
    services.push({
      name: service.serviceName,
      type: 'nextjs',
      status: service.status,
      resources: {
        ecsService: false,
        appRunnerService: true,
        spaBucket: false,
      },
    });
  }

  // Add SPA buckets
  for (const bucket of spaResult.buckets) {
    services.push({
      name: bucket.serviceName,
      type: 'spa',
      status: 'DEPLOYED',
      resources: {
        ecsService: false,
        appRunnerService: false,
        spaBucket: true,
      },
    });
  }

  // Sort by name for consistent output
  services.sort((a, b) => a.name.localeCompare(b.name));

  return {
    success: true,
    services,
  };
}
