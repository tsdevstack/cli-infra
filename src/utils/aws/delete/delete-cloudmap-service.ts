/**
 * Delete CloudMap Service Instance
 *
 * Deregisters a service from AWS Cloud Map (Service Discovery).
 * Note: ECS services with service discovery auto-deregister on deletion,
 * but this provides explicit cleanup if needed.
 *
 * Idempotent: Returns success if service/instance doesn't exist.
 */

import {
  ServiceDiscoveryClient,
  ListServicesCommand,
  ListInstancesCommand,
  DeregisterInstanceCommand,
} from '@aws-sdk/client-servicediscovery';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from 'tsdevstack/plugin';

export interface DeleteCloudMapServiceOptions {
  projectName: string;
  serviceName: string;
  credentials: AWSCredentials;
}

export interface DeleteCloudMapServiceResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Deregister service instances from CloudMap
 *
 * Idempotent: Returns success if service/instance already deleted.
 */
export async function deleteCloudMapService(
  options: DeleteCloudMapServiceOptions,
): Promise<DeleteCloudMapServiceResult> {
  const { serviceName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new ServiceDiscoveryClient(clientConfig);

  try {
    // List services to find the service ID
    const listServicesResponse = await client.send(new ListServicesCommand({}));

    const service = listServicesResponse.Services?.find(
      (s: { Name?: string }) => s.Name === serviceName,
    );

    // Service doesn't exist - already cleaned up
    if (!service || !service.Id) {
      return { success: true, deleted: false };
    }

    // List instances for this service
    const listInstancesResponse = await client.send(
      new ListInstancesCommand({
        ServiceId: service.Id,
      }),
    );

    const instances = listInstancesResponse.Instances || [];

    // No instances to deregister
    if (instances.length === 0) {
      return { success: true, deleted: false };
    }

    // Deregister each instance
    for (const instance of instances) {
      if (instance.Id) {
        await client.send(
          new DeregisterInstanceCommand({
            ServiceId: service.Id,
            InstanceId: instance.Id,
          }),
        );
      }
    }

    return { success: true, deleted: instances.length > 0 };
  } catch (error) {
    // ServiceNotFound or ResourceNotFoundException means already deleted
    if (
      error instanceof Error &&
      (error.name === 'ServiceNotFound' ||
        error.name === 'ResourceNotFoundException')
    ) {
      return { success: true, deleted: false };
    }

    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
