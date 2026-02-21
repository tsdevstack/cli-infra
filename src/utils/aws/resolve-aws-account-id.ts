/**
 * Resolve AWS Account ID via STS
 *
 * When running in CI with OIDC, AWS_ACCOUNT_ID may not be set.
 * Uses STS GetCallerIdentity to resolve it from the active credentials.
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from './build-aws-client-config';

/**
 * Resolve AWS account ID from STS if not already set on credentials
 */
export async function resolveAWSAccountId(
  credentials: AWSCredentials,
): Promise<void> {
  if (credentials.accountId) {
    return;
  }

  const config = buildAWSClientConfig(credentials);
  const sts = new STSClient(config);
  const response = await sts.send(new GetCallerIdentityCommand({}));

  if (!response.Account) {
    throw new Error('Failed to resolve AWS account ID from STS');
  }

  credentials.accountId = response.Account;
}
