/**
 * List ECS Services
 *
 * Lists all ECS services in a cluster with their status.
 */

import {
  ECSClient,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
} from '@aws-sdk/client-ecs';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from 'tsdevstack/plugin';

export interface ListEcsServicesOptions {
  clusterName: string;
  credentials: AWSCredentials;
}

export interface EcsServiceInfo {
  /** Full service name (e.g., tsdevstack-auth-service) */
  name: string;
  /** Service name without project prefix (e.g., auth-service) */
  serviceName: string;
  status: string;
  runningCount: number;
  desiredCount: number;
  pendingCount: number;
  /** Container image URI (e.g., 123456.dkr.ecr.us-east-1.amazonaws.com/repo:latest) */
  imageUri?: string;
}

export interface ListEcsServicesResult {
  success: boolean;
  services: EcsServiceInfo[];
  error?: string;
}

/**
 * List all ECS services in a cluster
 */
export async function listEcsServices(
  options: ListEcsServicesOptions,
): Promise<ListEcsServicesResult> {
  const { clusterName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new ECSClient(clientConfig);

  try {
    // Step 1: List service ARNs
    const listResponse = await client.send(
      new ListServicesCommand({
        cluster: clusterName,
        maxResults: 100,
      }),
    );

    const serviceArns = listResponse.serviceArns ?? [];

    if (serviceArns.length === 0) {
      return { success: true, services: [] };
    }

    // Step 2: Describe services to get details
    const describeResponse = await client.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: serviceArns,
      }),
    );

    // Step 3: Extract task definition ARNs and fetch image info in parallel
    const taskDefArns = new Map<string, string>();
    for (const service of describeResponse.services ?? []) {
      if (service.taskDefinition && service.serviceName) {
        taskDefArns.set(service.serviceName, service.taskDefinition);
      }
    }

    const imageMap = new Map<string, string>();
    const taskDefPromises = Array.from(taskDefArns.entries()).map(
      async ([svcName, arn]) => {
        try {
          const tdResponse = await client.send(
            new DescribeTaskDefinitionCommand({ taskDefinition: arn }),
          );
          const image =
            tdResponse.taskDefinition?.containerDefinitions?.[0]?.image;
          if (image) {
            imageMap.set(svcName, image);
          }
        } catch {
          // Ignore — image info is optional
        }
      },
    );
    await Promise.all(taskDefPromises);

    const services: EcsServiceInfo[] = (describeResponse.services ?? []).map(
      (service) => {
        const fullName = service.serviceName ?? '';
        // Extract service name by removing project prefix (e.g., "tsdevstack-auth-service" -> "auth-service")
        // The cluster name format is "${project_name}-cluster", so we can derive project name from it
        const projectName = clusterName.replace(/-cluster$/, '');
        const serviceName = fullName.startsWith(`${projectName}-`)
          ? fullName.slice(projectName.length + 1)
          : fullName;

        return {
          name: fullName,
          serviceName,
          status: service.status ?? 'UNKNOWN',
          runningCount: service.runningCount ?? 0,
          desiredCount: service.desiredCount ?? 0,
          pendingCount: service.pendingCount ?? 0,
          imageUri: imageMap.get(fullName),
        };
      },
    );

    return { success: true, services };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, services: [], error: message };
  }
}
