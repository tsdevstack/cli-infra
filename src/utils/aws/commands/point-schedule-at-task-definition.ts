/**
 * Point a cron job's EventBridge schedule at a task definition revision
 */

import {
  SchedulerClient,
  GetScheduleCommand,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { AWS_SCHEDULE_GROUP } from '../../../constants';
import { buildAWSClientConfig } from '../build-aws-client-config';

export interface PointScheduleAtTaskDefinitionOptions {
  credentials: AWSCredentials;
  scheduleName: string;
  taskDefinitionArn: string;
}

/**
 * UpdateSchedule replaces the whole schedule, so everything but the task
 * definition is copied from GetSchedule as it is. Terraform leaves this one
 * attribute alone (cron-jobs.tf's ignore_changes).
 *
 * @returns false when the schedule doesn't exist
 * @throws When the schedule starts no ECS task, or AWS refuses
 */
export async function pointScheduleAtTaskDefinition(
  options: PointScheduleAtTaskDefinitionOptions,
): Promise<boolean> {
  const scheduler = new SchedulerClient(
    buildAWSClientConfig(options.credentials),
  );

  let schedule;
  try {
    schedule = await scheduler.send(
      new GetScheduleCommand({
        Name: options.scheduleName,
        GroupName: AWS_SCHEDULE_GROUP,
      }),
    );
  } catch (error) {
    if (
      (error as { name?: string } | null)?.name === 'ResourceNotFoundException'
    ) {
      return false;
    }
    throw error;
  }

  const { Target, ScheduleExpression, FlexibleTimeWindow } = schedule;
  if (!Target?.EcsParameters || !ScheduleExpression || !FlexibleTimeWindow) {
    throw new Error(
      `Schedule ${options.scheduleName} does not start an ECS task`,
    );
  }

  await scheduler.send(
    new UpdateScheduleCommand({
      Name: options.scheduleName,
      GroupName: AWS_SCHEDULE_GROUP,
      ScheduleExpression,
      ScheduleExpressionTimezone: schedule.ScheduleExpressionTimezone,
      StartDate: schedule.StartDate,
      EndDate: schedule.EndDate,
      Description: schedule.Description,
      State: schedule.State,
      KmsKeyArn: schedule.KmsKeyArn,
      ActionAfterCompletion: schedule.ActionAfterCompletion,
      FlexibleTimeWindow,
      Target: {
        ...Target,
        EcsParameters: {
          ...Target.EcsParameters,
          TaskDefinitionArn: options.taskDefinitionArn,
        },
      },
    }),
  );
  return true;
}
