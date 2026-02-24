/**
 * Get ECS Service Details (AWS)
 *
 * Fetches detailed information about a specific ECS service.
 */

import { ECSClient, DescribeServicesCommand } from '@aws-sdk/client-ecs';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface GetEcsServiceOptions {
  clusterName: string;
  serviceName: string;
  credentials: AWSCredentials;
}

export interface EcsServiceDetails {
  exists: boolean;
  serviceName: string;
  status: string;
  runningCount: number;
  desiredCount: number;
  pendingCount: number;
  taskDefinition?: string;
  deploymentStatus?: string;
  healthCheckGracePeriod?: number;
  createdAt?: Date;
  events?: Array<{
    message: string;
    createdAt?: Date;
  }>;
  networkConfiguration?: {
    subnets: string[];
    securityGroups: string[];
    assignPublicIp: boolean;
  };
}

export interface GetEcsServiceResult {
  success: boolean;
  service: EcsServiceDetails;
  error?: string;
}

/**
 * Get detailed information about a specific ECS service
 */
export async function getEcsService(
  options: GetEcsServiceOptions,
): Promise<GetEcsServiceResult> {
  const { clusterName, serviceName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new ECSClient(clientConfig);

  try {
    const command = new DescribeServicesCommand({
      cluster: clusterName,
      services: [serviceName],
    });

    const response = await client.send(command);

    if (!response.services || response.services.length === 0) {
      return {
        success: true,
        service: {
          exists: false,
          serviceName,
          status: 'NOT_FOUND',
          runningCount: 0,
          desiredCount: 0,
          pendingCount: 0,
        },
      };
    }

    const service = response.services[0];

    // Get recent events (last 5)
    const events = service.events?.slice(0, 5).map((event) => ({
      message: event.message ?? '',
      createdAt: event.createdAt,
    }));

    // Get deployment status
    const primaryDeployment = service.deployments?.find(
      (d) => d.status === 'PRIMARY',
    );

    // Extract network configuration
    const awsvpcConfig = service.networkConfiguration?.awsvpcConfiguration;
    const networkConfiguration = awsvpcConfig
      ? {
          subnets: awsvpcConfig.subnets ?? [],
          securityGroups: awsvpcConfig.securityGroups ?? [],
          assignPublicIp: awsvpcConfig.assignPublicIp === 'ENABLED',
        }
      : undefined;

    return {
      success: true,
      service: {
        exists: true,
        serviceName: service.serviceName ?? serviceName,
        status: service.status ?? 'UNKNOWN',
        runningCount: service.runningCount ?? 0,
        desiredCount: service.desiredCount ?? 0,
        pendingCount: service.pendingCount ?? 0,
        taskDefinition: service.taskDefinition,
        deploymentStatus: primaryDeployment?.rolloutState,
        healthCheckGracePeriod: service.healthCheckGracePeriodSeconds,
        createdAt: service.createdAt,
        events,
        networkConfiguration,
      },
    };
  } catch (error) {
    return {
      success: false,
      service: {
        exists: false,
        serviceName,
        status: 'ERROR',
        runningCount: 0,
        desiredCount: 0,
        pendingCount: 0,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
