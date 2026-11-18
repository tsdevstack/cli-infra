/**
 * Which of these log groups exist in one region, with their ARN (as Live
 * Tail takes it) and class. Asks DescribeLogGroups by name, in batches of
 * AWS_DESCRIBE_LOG_GROUPS_BATCH.
 */

import {
  DescribeLogGroupsCommand,
  type CloudWatchLogsClient,
} from '@aws-sdk/client-cloudwatch-logs';
import { getContext } from '../../../context';
import { AWS_DESCRIBE_LOG_GROUPS_BATCH } from '../../../constants';
import type { AwsExistingLogGroup } from './types';

export async function listAwsExistingLogGroups(
  client: CloudWatchLogsClient,
  names: string[],
): Promise<Map<string, AwsExistingLogGroup>> {
  const { CliError } = getContext();
  const existing = new Map<string, AwsExistingLogGroup>();
  const unique = [...new Set(names)];

  for (let i = 0; i < unique.length; i += AWS_DESCRIBE_LOG_GROUPS_BATCH) {
    let response;
    try {
      response = await client.send(
        new DescribeLogGroupsCommand({
          logGroupIdentifiers: unique.slice(
            i,
            i + AWS_DESCRIBE_LOG_GROUPS_BATCH,
          ),
        }),
      );
    } catch (error) {
      const name = (error as { name?: string } | undefined)?.name;
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(
        `Cannot list the CloudWatch log groups: ${message}`,
        'infra:logs --follow',
        name === 'AccessDeniedException'
          ? 'The deploy credentials need logs:DescribeLogGroups.'
          : undefined,
      );
    }

    for (const group of response.logGroups ?? []) {
      // logGroupArn has no trailing ":*" (arn has it)
      const arn = group.logGroupArn ?? group.arn?.replace(/:\*$/, '');
      if (group.logGroupName && arn) {
        existing.set(group.logGroupName, {
          arn,
          ...(group.logGroupClass && { logGroupClass: group.logGroupClass }),
        });
      }
    }
  }

  return existing;
}
