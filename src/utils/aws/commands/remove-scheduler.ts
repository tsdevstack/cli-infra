/**
 * AWS Remove Scheduler Handler
 *
 * Removes a scheduled job from EventBridge Scheduler.
 * Discovery-based: queries AWS for deployed schedules.
 */

import inquirer from 'inquirer';
import {
  SchedulerClient,
  ListSchedulesCommand,
} from '@aws-sdk/client-scheduler';
import { getContext } from '../../../context';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { deleteSchedulerSchedule } from '../delete/delete-scheduler-schedule';
import type { AWSCommandContext } from './types';

export interface RemoveSchedulerOptions {
  job?: string;
  confirm?: boolean;
}

interface DeployedSchedule {
  name: string;
  state: string;
}

/**
 * Remove a scheduled job from EventBridge Scheduler
 */
export async function awsRemoveScheduler(
  ctx: AWSCommandContext,
  options: RemoveSchedulerOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  const { targetEnv, credentials } = ctx;

  // Resolve schedule name
  let scheduleName: string;
  if (options.job) {
    scheduleName = options.job;
  } else {
    scheduleName = await selectScheduleInteractive(ctx);
  }

  logger.info(`Schedule: ${scheduleName}`);
  logger.info(`Environment: ${targetEnv}`);
  logger.newline();

  // Confirmation (interactive only — CI confirm is handled by dispatcher)
  if (!ctx.runningInCI) {
    logger.warn(
      'This will PERMANENTLY DELETE the schedule from EventBridge Scheduler.',
    );
    logger.newline();

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Delete schedule "${scheduleName}" from ${targetEnv}?`,
        default: false,
      },
    ]);

    if (!confirmed) {
      logger.info('Aborted.');
      return;
    }
  }

  // Delete EventBridge Scheduler schedule
  logger.info('Deleting EventBridge Scheduler schedule...');

  const result = await deleteSchedulerSchedule({
    scheduleName,
    credentials,
  });

  if (!result.success) {
    throw new CliError(
      `Failed to delete schedule: ${result.error}`,
      'infra:remove-scheduler',
      'Check if the schedule exists and you have permissions',
    );
  }

  if (result.deleted) {
    logger.success(`Deleted schedule: ${scheduleName}`);
  } else {
    logger.info(`Schedule not found (already deleted): ${scheduleName}`);
  }

  logger.newline();
  logger.success(`Schedule "${scheduleName}" removed from ${targetEnv}`);
  logger.newline();

  // Warning about infrastructure.json cleanup
  logger.warn(
    'Remember to remove this job from .tsdevstack/infrastructure.json',
  );
  logger.info(
    'The framework does not auto-modify user-managed configuration files.',
  );
  logger.newline();
}

/**
 * Discover deployed EventBridge Scheduler schedules
 */
async function discoverDeployedSchedules(
  ctx: AWSCommandContext,
): Promise<DeployedSchedule[]> {
  const { CliError } = getContext();
  const { projectName, credentials } = ctx;

  const clientConfig = buildAWSClientConfig(credentials);
  const scheduler = new SchedulerClient(clientConfig);

  const prefix = `${projectName}-`;
  const schedules: DeployedSchedule[] = [];

  try {
    let nextToken: string | undefined;

    do {
      const response = await scheduler.send(
        new ListSchedulesCommand({
          NamePrefix: prefix,
          GroupName: 'default',
          NextToken: nextToken,
        }),
      );

      for (const schedule of response.Schedules ?? []) {
        if (schedule.Name) {
          schedules.push({
            name: schedule.Name,
            state: schedule.State ?? 'UNKNOWN',
          });
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new CliError(
      'Failed to list EventBridge Scheduler schedules',
      'infra:remove-scheduler',
      errorMessage,
    );
  }

  return schedules;
}

/**
 * Interactively select a schedule from deployed EventBridge schedules
 */
async function selectScheduleInteractive(
  ctx: AWSCommandContext,
): Promise<string> {
  const { logger, CliError } = getContext();

  logger.info('Discovering deployed schedules...');
  logger.newline();

  const deployedSchedules = await discoverDeployedSchedules(ctx);

  if (deployedSchedules.length === 0) {
    throw new CliError(
      'No deployed schedules found',
      'infra:remove-scheduler',
      'No EventBridge Scheduler schedules found in this environment',
    );
  }

  // Build choices with schedule details
  const choices = deployedSchedules.map((schedule) => ({
    name: `${schedule.name} - ${schedule.state}`,
    value: schedule.name,
  }));

  // Add manual entry option
  choices.push({
    name: '[ Enter schedule name manually ]',
    value: '__manual__',
  });

  const { selectedSchedule } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedSchedule',
      message: 'Select schedule to remove:',
      choices,
    },
  ]);

  // If manual entry selected, prompt for name
  if (selectedSchedule === '__manual__') {
    const { enteredName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'enteredName',
        message: 'Enter schedule name to remove:',
        validate: (input: string) => {
          if (!input || !input.trim()) {
            return 'Schedule name is required';
          }
          return true;
        },
      },
    ]);
    return enteredName.trim();
  }

  return selectedSchedule;
}
