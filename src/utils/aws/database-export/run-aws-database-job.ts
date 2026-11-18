/**
 * Save or restore a service's database with db-init (AWS)
 */

import path from 'node:path';
import {
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
} from '@aws-sdk/client-ecs';
import {
  buildAwsTerraformEnv,
  DB_EXPORT_JOB_TIMEOUT_SECONDS,
  ECS_TASK_EXIT_CODE_GRACE_POLLS,
  readEcsTaskOutcome,
  sleep,
  type EcsTaskOutcome,
} from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { getTerraformOutput } from '../terraform';
import { readDbInitLogTail } from './read-db-init-log-tail';
import type { AWSCommandContext } from '../commands/types';
import {
  AWS_DB_INIT_CONTAINER_NAME,
  AWS_DB_INIT_TASK_FAMILY_SUFFIX,
  AWS_DB_JOB_POLL_MS,
  AWS_DB_JOB_START_MARGIN_SECONDS,
  AWS_DB_JOB_STATUS_ERRORS_ALLOWED,
  AWS_ECS_CLUSTER_SUFFIX,
} from '../../../constants';

export interface RunAwsDatabaseJobOptions {
  ctx: AWSCommandContext;
  /** export: save the database to the file; restore: replace it with the file */
  mode: 'export' | 'restore';
  serviceName: string;
  /** The file in the exports bucket ({service}/{time}-{reason}.dump) */
  file: string;
}

/**
 * Runs db-init (the task definition infra:deploy keeps up to date) as a
 * one-off ECS task in the private subnets, in its export or restore mode
 * for one service, with the exports bucket. ECS has no time limit for a
 * task: past the job's limit the CLI stops it.
 *
 * @throws CliError with the end of the task's log when it fails
 */
export async function runAwsDatabaseJob(
  options: RunAwsDatabaseJobOptions,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { ctx, mode, serviceName } = options;
  const { credentials, projectName } = ctx;
  const terraformDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );
  const tfEnv = buildAwsTerraformEnv(buildRuntime(), credentials);
  const output = (name: string): string =>
    getTerraformOutput(terraformDir, name, tfEnv);

  const cluster = `${projectName}${AWS_ECS_CLUSTER_SUFFIX}`;
  const ecs = new ECSClient(buildAWSClientConfig(credentials));
  const failed = (message: string, logs?: string | null): never => {
    throw new CliError(
      `db-init (${mode}) failed: ${message}`,
      'Database job',
      logs ??
        `Its output is in the CloudWatch log group /ecs/${projectName}/${AWS_DB_INIT_CONTAINER_NAME}.`,
    );
  };

  logger.info(`Running db-init (${mode}) for ${serviceName}...`);
  const started = await ecs.send(
    new RunTaskCommand({
      cluster,
      taskDefinition: `${projectName}${AWS_DB_INIT_TASK_FAMILY_SUFFIX}`,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: JSON.parse(output('private_subnet_ids')) as string[],
          securityGroups: [output('ecs_security_group_id')],
          assignPublicIp: 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: AWS_DB_INIT_CONTAINER_NAME,
            environment: [
              { name: 'MODE', value: mode },
              { name: 'SERVICES', value: JSON.stringify([serviceName]) },
              { name: 'EXPORT_FILE', value: options.file },
              { name: 'EXPORT_BUCKET', value: output('db_exports_bucket') },
            ],
          },
        ],
      },
    }),
  );
  const taskArn = started.tasks?.[0]?.taskArn;
  if (!taskArn) {
    return failed(
      `the task did not start (${started.failures?.[0]?.reason ?? 'no reason given'})`,
    );
  }

  const deadline =
    Date.now() +
    (DB_EXPORT_JOB_TIMEOUT_SECONDS + AWS_DB_JOB_START_MARGIN_SECONDS) * 1000;
  let outcome: EcsTaskOutcome | undefined;
  let statusErrors = 0;
  let pendingPolls = 0;
  while (Date.now() < deadline) {
    try {
      const described = await ecs.send(
        new DescribeTasksCommand({ cluster, tasks: [taskArn] }),
      );
      statusErrors = 0;
      const task = described.tasks?.[0];
      if (task) {
        outcome = readEcsTaskOutcome(task, AWS_DB_INIT_CONTAINER_NAME);
        if (outcome.state === 'succeeded') {
          logger.success(`db-init (${mode}) completed`);
          return;
        }
        if (outcome.state === 'failed') {
          break;
        }
        // STOPPED before the exit code is recorded: ask again a few times
        if (
          outcome.state === 'exit-code-pending' &&
          ++pendingPolls > ECS_TASK_EXIT_CODE_GRACE_POLLS
        ) {
          break;
        }
      }
    } catch (error) {
      // A status check with no answer: the task keeps running
      if (++statusErrors > AWS_DB_JOB_STATUS_ERRORS_ALLOWED) {
        return failed(
          `its status can't be read (${error instanceof Error ? error.message : String(error)}). The task may still be running: ${taskArn}`,
        );
      }
    }
    await sleep(AWS_DB_JOB_POLL_MS);
  }

  if (!outcome || outcome.state === 'running') {
    await ecs
      .send(
        new StopTaskCommand({
          cluster,
          task: taskArn,
          reason: 'Over the time limit of the database job',
        }),
      )
      .catch(() => undefined);
    return failed(
      `it ran longer than ${DB_EXPORT_JOB_TIMEOUT_SECONDS / 60} minutes and was stopped`,
    );
  }

  const logs = await readDbInitLogTail({ projectName, taskArn, credentials });
  return failed(
    outcome.exitCode !== undefined
      ? `exit code ${outcome.exitCode}${outcome.reason ? ` (${outcome.reason})` : ''}`
      : `the task stopped without an exit code${outcome.reason ? ` (${outcome.reason})` : ''}`,
    logs,
  );
}
