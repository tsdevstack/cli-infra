/**
 * Discover AWS Cron Jobs
 *
 * Finds this project's cron jobs on AWS by their task definitions' tags, not
 * from infrastructure.json: a job whose entry was removed is still found.
 * The families `{project}-cron-*` with an ACTIVE revision count when that
 * revision carries the project's tag (main.tf's default_tags) and the cron
 * job tags (cron-jobs.tf; deploys copy them to each revision they
 * register). The name prefix alone also matches a project whose name is this
 * one plus "-cron-...".
 */

import {
  ECSClient,
  DescribeTaskDefinitionCommand,
  ListTaskDefinitionFamiliesCommand,
} from '@aws-sdk/client-ecs';
import {
  AWS_CRON_JOB_NAME_TAG,
  AWS_CRON_JOB_SERVICE_TAG,
  AWS_PROJECT_TAG,
  CRON_JOB_NAME_PREFIX,
} from '@tsdevstack/infra-core';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';
import {
  buildAwsCronJobNames,
  type AwsCronJobNames,
} from '../build-aws-cron-job-names';

export interface DiscoverAwsCronJobsOptions {
  projectName: string;
  credentials: AWSCredentials;
}

export interface AwsCronJobInfo extends AwsCronJobNames {
  /** The cron job's config name */
  name: string;
  /** The service whose image it runs */
  serviceName: string;
}

/**
 * @throws The API's error when the families can't be listed or read
 */
export async function discoverAwsCronJobs(
  options: DiscoverAwsCronJobsOptions,
): Promise<AwsCronJobInfo[]> {
  const { projectName, credentials } = options;
  const ecs = new ECSClient(buildAWSClientConfig(credentials));

  const families: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await ecs.send(
      new ListTaskDefinitionFamiliesCommand({
        familyPrefix: `${projectName}-${CRON_JOB_NAME_PREFIX}`,
        status: 'ACTIVE',
        nextToken,
      }),
    );
    families.push(...(page.families ?? []));
    nextToken = page.nextToken;
  } while (nextToken);

  const found: AwsCronJobInfo[] = [];
  for (const family of families) {
    const { tags } = await ecs.send(
      new DescribeTaskDefinitionCommand({
        taskDefinition: family,
        include: ['TAGS'],
      }),
    );
    const tag = (key: string): string | undefined =>
      tags?.find((entry) => entry.key === key)?.value;
    const serviceName = tag(AWS_CRON_JOB_SERVICE_TAG);
    const name = tag(AWS_CRON_JOB_NAME_TAG);
    if (tag(AWS_PROJECT_TAG) !== projectName || !serviceName || !name) {
      continue;
    }
    found.push({
      name,
      serviceName,
      ...buildAwsCronJobNames(projectName, serviceName, name),
    });
  }
  return found;
}
