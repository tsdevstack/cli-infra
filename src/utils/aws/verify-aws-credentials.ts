/**
 * Verify AWS Credentials
 *
 * Uses STS GetCallerIdentity to verify credentials work and get identity info.
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import type { AWSCredentials } from 'tsdevstack/plugin';
import { buildAWSClientConfig } from './build-aws-client-config';

export interface AWSIdentity {
  accountId: string;
  arn: string;
  userId: string;
  /** Whether this is an IAM user or assumed role */
  principalType: 'user' | 'role' | 'assumed-role';
  /** The IAM user name or role name */
  principalName: string;
}

export interface VerifyCredentialsResult {
  success: boolean;
  identity?: AWSIdentity;
  error?: string;
}

/**
 * Verify AWS credentials and get identity information
 */
export async function verifyAWSCredentials(
  credentials: AWSCredentials,
): Promise<VerifyCredentialsResult> {
  const config = buildAWSClientConfig(credentials);
  const sts = new STSClient(config);

  try {
    const response = await sts.send(new GetCallerIdentityCommand({}));

    if (!response.Account || !response.Arn || !response.UserId) {
      return {
        success: false,
        error: 'Invalid response from STS GetCallerIdentity',
      };
    }

    // Parse ARN to determine principal type and name
    // Examples:
    // - arn:aws:iam::123456789:user/my-user
    // - arn:aws:iam::123456789:role/my-role
    // - arn:aws:sts::123456789:assumed-role/my-role/session-name
    const arnParts = response.Arn.split(':');
    const resourcePart = arnParts[5] || '';
    const [resourceType, ...nameParts] = resourcePart.split('/');

    let principalType: 'user' | 'role' | 'assumed-role';
    if (resourceType === 'user') {
      principalType = 'user';
    } else if (resourceType === 'role') {
      principalType = 'role';
    } else {
      principalType = 'assumed-role';
    }

    return {
      success: true,
      identity: {
        accountId: response.Account,
        arn: response.Arn,
        userId: response.UserId,
        principalType,
        principalName: nameParts[0] || resourceType,
      },
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}
