/**
 * Delete CloudWatch Log Group
 *
 * Deletes a CloudWatch log group for a service.
 * Idempotent: Returns success if log group doesn't exist.
 */

import {
  CloudWatchLogsClient,
  DeleteLogGroupCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-cloudwatch-logs';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface DeleteCloudWatchLogGroupOptions {
  logGroupName: string;
  credentials: AWSCredentials;
}

export interface DeleteCloudWatchLogGroupResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete a CloudWatch log group
 *
 * Idempotent: Returns success if log group already deleted.
 */
export async function deleteCloudWatchLogGroup(
  options: DeleteCloudWatchLogGroupOptions,
): Promise<DeleteCloudWatchLogGroupResult> {
  const { logGroupName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new CloudWatchLogsClient(clientConfig);

  try {
    await client.send(
      new DeleteLogGroupCommand({
        logGroupName,
      }),
    );

    return { success: true, deleted: true };
  } catch (error) {
    // ResourceNotFoundException means already deleted
    if (
      error instanceof ResourceNotFoundException ||
      (error instanceof Error && error.name === 'ResourceNotFoundException')
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
