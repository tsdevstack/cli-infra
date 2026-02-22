/**
 * Delete ECS Service
 *
 * Deletes an ECS service by first scaling it to 0, then deleting it.
 */

import {
  ECSClient,
  UpdateServiceCommand,
  DeleteServiceCommand,
  DescribeServicesCommand,
} from '@aws-sdk/client-ecs';
import type { AWSCredentials } from 'tsdevstack/plugin';
import { getContext } from '../../../context';

export interface DeleteEcsServiceOptions {
  credentials: AWSCredentials;
  clusterName: string;
  serviceName: string;
}

export interface DeleteEcsServiceResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete an ECS service
 */
export async function deleteEcsService(
  options: DeleteEcsServiceOptions,
): Promise<DeleteEcsServiceResult> {
  const { isCIEnv } = getContext();
  const { credentials, clusterName, serviceName } = options;

  // Build ECS client config
  const clientConfig: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  } = {
    region: credentials.region,
  };

  if (!isCIEnv()) {
    clientConfig.credentials = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    };
  }

  const ecs = new ECSClient(clientConfig);

  try {
    // First check if service exists
    const describeResponse = await ecs.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName],
      }),
    );

    const service = describeResponse.services?.[0];
    if (!service || service.status === 'INACTIVE') {
      return { success: true, deleted: false };
    }

    // Scale down to 0 first
    await ecs.send(
      new UpdateServiceCommand({
        cluster: clusterName,
        service: serviceName,
        desiredCount: 0,
      }),
    );

    // Delete the service
    await ecs.send(
      new DeleteServiceCommand({
        cluster: clusterName,
        service: serviceName,
        force: true, // Force delete even if tasks are running
      }),
    );

    return { success: true, deleted: true };
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string };

    // Service not found is not an error
    if (error.name === 'ServiceNotFoundException') {
      return { success: true, deleted: false };
    }

    return {
      success: false,
      deleted: false,
      error: error.message || 'Unknown error deleting ECS service',
    };
  }
}
