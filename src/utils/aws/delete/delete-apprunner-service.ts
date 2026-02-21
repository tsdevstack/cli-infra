/**
 * Delete App Runner Service
 *
 * Deletes an App Runner service by its service ARN.
 * Idempotent: Returns success if service doesn't exist.
 */

import {
  AppRunnerClient,
  ListServicesCommand,
  DeleteServiceCommand,
} from '@aws-sdk/client-apprunner';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface DeleteAppRunnerServiceOptions {
  projectName: string;
  targetEnv: string;
  serviceName: string;
  credentials: AWSCredentials;
}

export interface DeleteAppRunnerServiceResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete an App Runner service
 *
 * Idempotent: Returns success if service already deleted.
 */
export async function deleteAppRunnerService(
  options: DeleteAppRunnerServiceOptions,
): Promise<DeleteAppRunnerServiceResult> {
  const { projectName, targetEnv, serviceName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new AppRunnerClient(clientConfig);

  // App Runner services are named: {project}-{env}-{service}
  const fullServiceName = `${projectName}-${targetEnv}-${serviceName}`;

  try {
    // First, list services to find the ARN
    const listCommand = new ListServicesCommand({});
    const listResponse = await client.send(listCommand);

    const serviceEntry = listResponse.ServiceSummaryList?.find(
      (s) => s.ServiceName === fullServiceName,
    );

    // Service doesn't exist - already deleted
    if (!serviceEntry || !serviceEntry.ServiceArn) {
      return { success: true, deleted: false };
    }

    // Delete the service
    await client.send(
      new DeleteServiceCommand({
        ServiceArn: serviceEntry.ServiceArn,
      }),
    );

    return { success: true, deleted: true };
  } catch (error) {
    // ResourceNotFoundException means already deleted
    if (error instanceof Error && error.name === 'ResourceNotFoundException') {
      return { success: true, deleted: false };
    }

    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
