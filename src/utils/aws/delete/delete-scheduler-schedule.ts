/**
 * Delete Scheduler Schedule
 *
 * Deletes an EventBridge Scheduler schedule.
 * Treats ResourceNotFoundException as success (idempotent).
 */

import {
  SchedulerClient,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';

export interface DeleteSchedulerScheduleOptions {
  credentials: AWSCredentials;
  scheduleName: string;
}

export interface DeleteSchedulerScheduleResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete an EventBridge Scheduler schedule
 */
export async function deleteSchedulerSchedule(
  options: DeleteSchedulerScheduleOptions,
): Promise<DeleteSchedulerScheduleResult> {
  const { credentials, scheduleName } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const scheduler = new SchedulerClient(clientConfig);

  try {
    await scheduler.send(
      new DeleteScheduleCommand({
        Name: scheduleName,
        GroupName: 'default',
      }),
    );

    return { success: true, deleted: true };
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string };

    // Schedule not found is not an error (idempotent)
    if (error.name === 'ResourceNotFoundException') {
      return { success: true, deleted: false };
    }

    return {
      success: false,
      deleted: false,
      error: error.message || 'Unknown error deleting scheduler schedule',
    };
  }
}
