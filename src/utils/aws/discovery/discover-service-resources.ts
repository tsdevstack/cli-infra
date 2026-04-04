/**
 * Discover Service Resources (AWS)
 *
 * Orchestrates all discovery calls to determine what cloud resources
 * exist for a specific service. Infers service type from discovered resources.
 *
 * Cloud is the source of truth - this allows status checks even if service
 * has already been removed from config.json.
 */

import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getEcsService } from './get-ecs-service';
import { bucketExists } from './bucket-exists';
import { listSecretsByPrefix } from './list-secrets-by-prefix';

export interface DiscoverServiceResourcesOptions {
  serviceName: string;
  projectName: string;
  targetEnv: string;
  credentials: AWSCredentials;
}

export interface DiscoveredResources {
  // ECS Service (backends, workers, kong, nextjs)
  ecsService: boolean;
  ecsStatus?: string;
  ecsRunningCount?: number;
  ecsDesiredCount?: number;
  ecsTaskDefinition?: string;
  ecsDeploymentStatus?: string;
  ecsEvents?: Array<{
    message: string;
    createdAt?: Date;
  }>;

  // S3 SPA Bucket
  spaBucket: boolean;
  spaBucketName: string;

  // Secrets
  secrets: string[];

  // Network configuration (from ECS service if exists)
  networkConfiguration?: {
    subnets: string[];
    securityGroups: string[];
    assignPublicIp: boolean;
  };

  /**
   * Inferred type based on discovered resources:
   * - 'backend': ECS service with "-service" suffix
   * - 'worker': ECS service with "-worker" suffix
   * - 'kong': ECS service named "kong"
   * - 'spa': Only SPA bucket exists
   * - 'unknown': No resources found
   */
  inferredType: 'backend' | 'worker' | 'kong' | 'spa' | 'unknown';
}

/**
 * Discover all cloud resources for a service on AWS
 */
export async function discoverServiceResources(
  options: DiscoverServiceResourcesOptions,
): Promise<DiscoveredResources> {
  const { serviceName, projectName, credentials } = options;

  const clusterName = `${projectName}-cluster`;
  const spaBucketName = `${projectName}-${serviceName}-spa`;
  const secretPrefix = `${projectName}-${serviceName}-`;

  // Run all discovery calls in parallel for performance
  const [ecsResult, bucketResult, secretsResult] = await Promise.all([
    getEcsService({
      clusterName,
      serviceName,
      credentials,
    }),
    bucketExists({
      bucketName: spaBucketName,
      credentials,
    }),
    listSecretsByPrefix({
      prefix: secretPrefix,
      credentials,
    }),
  ]);

  const hasEcs = ecsResult.success && ecsResult.service.exists;
  const hasBucket = bucketResult.exists;

  // Infer type from discovered resources and service name
  let inferredType: DiscoveredResources['inferredType'] = 'unknown';
  if (hasEcs) {
    if (serviceName === 'kong') {
      inferredType = 'kong';
    } else if (serviceName.endsWith('-worker')) {
      inferredType = 'worker';
    } else {
      inferredType = 'backend';
    }
  } else if (hasBucket) {
    inferredType = 'spa';
  }

  return {
    ecsService: hasEcs,
    ecsStatus: hasEcs ? ecsResult.service.status : undefined,
    ecsRunningCount: hasEcs ? ecsResult.service.runningCount : undefined,
    ecsDesiredCount: hasEcs ? ecsResult.service.desiredCount : undefined,
    ecsTaskDefinition: hasEcs ? ecsResult.service.taskDefinition : undefined,
    ecsDeploymentStatus: hasEcs
      ? ecsResult.service.deploymentStatus
      : undefined,
    ecsEvents: hasEcs ? ecsResult.service.events : undefined,

    spaBucket: hasBucket,
    spaBucketName,

    networkConfiguration: hasEcs
      ? ecsResult.service.networkConfiguration
      : undefined,

    secrets: secretsResult.success
      ? secretsResult.secrets.map((s: { name: string }) => s.name)
      : [],

    inferredType,
  };
}
