/**
 * Build AWS Cron Job Names
 *
 * A cron job on AWS (cron-jobs.tf, A4's `cron-` prefix):
 * - task family `{project}-cron-{name}`, its container `cron-{name}`
 * - log group `/ecs/{project}/cron-{name}` (next to the services' own)
 * - EventBridge schedule `{project}-{service}-{name}`, named as a trigger's
 */

import { CRON_JOB_NAME_PREFIX } from '@tsdevstack/infra-core';
import { AWS_ECS_LOG_GROUP_PREFIX } from '../../constants';
import { buildAwsJobKey } from './build-aws-job-key';

export interface AwsCronJobNames {
  taskFamily: string;
  containerName: string;
  logGroupName: string;
  scheduleName: string;
}

export function buildAwsCronJobNames(
  projectName: string,
  serviceName: string,
  jobName: string,
): AwsCronJobNames {
  const prefixed = `${CRON_JOB_NAME_PREFIX}${jobName}`;
  return {
    taskFamily: `${projectName}-${prefixed}`,
    containerName: prefixed,
    logGroupName: `${AWS_ECS_LOG_GROUP_PREFIX}${projectName}/${prefixed}`,
    scheduleName: `${projectName}-${buildAwsJobKey(serviceName, jobName)}`,
  };
}
