/**
 * Build AWS DATABASE_URL Secret ARN
 *
 * The reference a task definition gives ECS for a service's DATABASE_URL:
 * the secret `{project}-{service}-DATABASE_URL` without Secrets Manager's
 * random suffix (ECS takes the partial ARN), the name the execution role may
 * read (iam-roles.tf). deployEcsServiceWithSecrets builds the same for the
 * service itself; its workers and cron jobs get the service's.
 */

import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';

export function buildAwsDatabaseUrlSecretArn(
  credentials: AWSCredentials,
  projectName: string,
  serviceName: string,
): string {
  const { buildSecretName } = getContext();
  return `arn:aws:secretsmanager:${credentials.region}:${credentials.accountId}:secret:${buildSecretName(projectName, serviceName, 'DATABASE_URL')}`;
}
