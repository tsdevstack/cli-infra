/**
 * Read one of the framework's EventBridge schedules
 */

import {
  SchedulerClient,
  GetScheduleCommand,
  type GetScheduleCommandOutput,
} from '@aws-sdk/client-scheduler';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { AWS_SCHEDULE_GROUP } from '../../../constants';
import { buildAWSClientConfig } from '../build-aws-client-config';

/**
 * @returns undefined when the schedule doesn't exist
 * @throws AWS's error for anything else
 */
export async function getAwsSchedule(
  credentials: AWSCredentials,
  scheduleName: string,
): Promise<GetScheduleCommandOutput | undefined> {
  try {
    return await new SchedulerClient(buildAWSClientConfig(credentials)).send(
      new GetScheduleCommand({
        Name: scheduleName,
        GroupName: AWS_SCHEDULE_GROUP,
      }),
    );
  } catch (error) {
    if (
      (error as { name?: string } | null)?.name === 'ResourceNotFoundException'
    ) {
      return undefined;
    }
    throw error;
  }
}
