/**
 * Grant AWS Permissions
 *
 * Attempts to attach managed policies to the principal.
 */

import {
  IAMClient,
  AttachUserPolicyCommand,
  AttachRolePolicyCommand,
} from '@aws-sdk/client-iam';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from './build-aws-client-config';
import { AWS_MANAGED_POLICIES } from '../../constants';
import type { AWSIdentity } from './verify-aws-credentials';

export interface GrantPermissionsResult {
  success: boolean;
  policiesAttached: string[];
  policiesFailed: string[];
  error?: string;
}

/**
 * Attempt to attach managed policies to the principal
 */
export async function grantAWSPermissions(
  credentials: AWSCredentials,
  identity: AWSIdentity,
): Promise<GrantPermissionsResult> {
  const config = buildAWSClientConfig(credentials);
  const iam = new IAMClient(config);

  const policiesAttached: string[] = [];
  const policiesFailed: string[] = [];

  try {
    for (const policyArn of AWS_MANAGED_POLICIES) {
      try {
        if (identity.principalType === 'user') {
          await iam.send(
            new AttachUserPolicyCommand({
              UserName: identity.principalName,
              PolicyArn: policyArn,
            }),
          );
        } else {
          // For roles and assumed-roles
          await iam.send(
            new AttachRolePolicyCommand({
              RoleName: identity.principalName,
              PolicyArn: policyArn,
            }),
          );
        }
        policiesAttached.push(policyArn);
      } catch {
        // Policy attachment failed - might already be attached or no permission
        policiesFailed.push(policyArn);
      }
    }

    return {
      success: policiesAttached.length > 0 || policiesFailed.length === 0,
      policiesAttached,
      policiesFailed,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      policiesAttached,
      policiesFailed,
      error: errorMessage,
    };
  }
}
