/**
 * Run db-init ECS task
 *
 * Runs the Terraform-created db-init task definition with container overrides
 * to pass the list of services that need databases.
 */

import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { sleep } from '@tsdevstack/infra-core';

export interface RunDbInitOptions {
  region: string;
  clusterName: string;
  taskDefinitionArn: string;
  subnetIds: string[];
  securityGroupId: string;
  credentials: AWSCredentials;
  services: Array<{ name: string; hasDatabase: boolean }>;
}

/**
 * Run the db-init ECS task and wait for completion
 */
export async function runDbInit(options: RunDbInitOptions): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();

  const servicesWithDb = options.services.filter((s) => s.hasDatabase);

  if (servicesWithDb.length === 0) {
    logger.info('No services with databases. Skipping db-init.');
    return;
  }

  logger.info('Running db-init...');
  logger.info(`  Services: ${servicesWithDb.map((s) => s.name).join(', ')}`);

  const ecsConfig = isCIEnv()
    ? { region: options.region }
    : {
        region: options.region,
        credentials: {
          accessKeyId: options.credentials.accessKeyId,
          secretAccessKey: options.credentials.secretAccessKey,
        },
      };

  const ecs = new ECSClient(ecsConfig);

  // Run the task with container overrides to pass SERVICES
  let taskArn: string;

  try {
    const runResponse = await ecs.send(
      new RunTaskCommand({
        cluster: options.clusterName,
        taskDefinition: options.taskDefinitionArn,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: options.subnetIds,
            securityGroups: [options.securityGroupId],
            assignPublicIp: 'DISABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: 'db-init',
              environment: [
                {
                  name: 'SERVICES',
                  value: JSON.stringify(servicesWithDb),
                },
              ],
            },
          ],
        },
      }),
    );

    if (!runResponse.tasks || runResponse.tasks.length === 0) {
      const failureReason =
        runResponse.failures?.[0]?.reason || 'Unknown failure';
      throw new Error(`Failed to start db-init task: ${failureReason}`);
    }

    taskArn = runResponse.tasks[0].taskArn!;
    logger.info(`  Task started: ${taskArn}`);
  } catch (error) {
    throw new CliError(
      'Failed to start db-init task',
      'db-init',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }

  // Poll for completion
  logger.info('  Waiting for db-init to complete...');
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 5000; // 5 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const describeResponse = await ecs.send(
        new DescribeTasksCommand({
          cluster: options.clusterName,
          tasks: [taskArn],
        }),
      );

      const task = describeResponse.tasks?.[0];
      if (!task) {
        throw new Error('Task not found');
      }

      const lastStatus = task.lastStatus;

      if (lastStatus === 'STOPPED') {
        // Check exit code
        const container = task.containers?.find((c) => c.name === 'db-init');
        const exitCode = container?.exitCode;

        if (exitCode === 0) {
          logger.success('  db-init completed successfully');
          return;
        } else {
          throw new CliError(
            `db-init failed with exit code ${exitCode}`,
            'db-init',
            'Check CloudWatch logs at /ecs/{project}/db-init for details',
          );
        }
      }

      await sleep(pollInterval);
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliError(
        'Failed to check db-init task status',
        'db-init',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  throw new CliError(
    'db-init task timed out after 5 minutes',
    'db-init',
    'Check CloudWatch logs at /ecs/{project}/db-init for details',
  );
}
