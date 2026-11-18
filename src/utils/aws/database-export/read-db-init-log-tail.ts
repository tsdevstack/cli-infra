/**
 * The end of a db-init task's log (AWS)
 */

import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';
import {
  AWS_DB_INIT_CONTAINER_NAME,
  AWS_DB_JOB_LOG_LINES,
  AWS_ECS_LOG_GROUP_PREFIX,
} from '../../../constants';

/**
 * db-init writes to /ecs/{project}/db-init, one stream per task
 * (db-init/db-init/{task ID}). Read when the task fails, for the error.
 *
 * @param options.projectName - The project
 * @param options.taskArn - The task that ran
 * @param options.credentials - The deploy account
 * @returns Its last lines, or null when they can't be read
 */
export async function readDbInitLogTail(options: {
  projectName: string;
  taskArn: string;
  credentials: AWSCredentials;
}): Promise<string | null> {
  const logs = new CloudWatchLogsClient(
    buildAWSClientConfig(options.credentials),
  );
  const taskId = options.taskArn.split('/').pop();
  try {
    const response = await logs.send(
      new GetLogEventsCommand({
        logGroupName: `${AWS_ECS_LOG_GROUP_PREFIX}${options.projectName}/${AWS_DB_INIT_CONTAINER_NAME}`,
        logStreamName: `${AWS_DB_INIT_CONTAINER_NAME}/${AWS_DB_INIT_CONTAINER_NAME}/${taskId}`,
        startFromHead: false,
        limit: AWS_DB_JOB_LOG_LINES,
      }),
    );
    const lines = (response.events ?? [])
      .map((event) => event.message?.trimEnd() ?? '')
      .filter(Boolean);
    return lines.length > 0 ? lines.join('\n') : null;
  } catch {
    return null;
  }
}
