/**
 * Check AWS Permissions
 *
 * Uses IAM SimulatePrincipalPolicy to check what permissions the principal has.
 */

import { IAMClient, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam';
import type { AWSCredentials } from 'tsdevstack/plugin';
import { buildAWSClientConfig } from './build-aws-client-config';
import { AWS_REQUIRED_ACTIONS } from '../../constants';

export interface CheckPermissionsResult {
  success: boolean;
  allowed: string[];
  denied: string[];
  error?: string;
}

/**
 * Check which required permissions the principal has
 */
export async function checkAWSPermissions(
  credentials: AWSCredentials,
  principalArn: string,
): Promise<CheckPermissionsResult> {
  const config = buildAWSClientConfig(credentials);
  const iam = new IAMClient(config);

  const allowed: string[] = [];
  const denied: string[] = [];

  try {
    // Simulate in batches (AWS limits to 100 actions per call)
    const batchSize = 100;
    for (let i = 0; i < AWS_REQUIRED_ACTIONS.length; i += batchSize) {
      const batch = AWS_REQUIRED_ACTIONS.slice(i, i + batchSize);

      const response = await iam.send(
        new SimulatePrincipalPolicyCommand({
          PolicySourceArn: principalArn,
          ActionNames: [...batch],
          // Use wildcard resource for general permission check
          ResourceArns: ['*'],
        }),
      );

      for (const result of response.EvaluationResults || []) {
        if (result.EvalActionName) {
          if (result.EvalDecision === 'allowed') {
            allowed.push(result.EvalActionName);
          } else {
            denied.push(result.EvalActionName);
          }
        }
      }
    }

    return {
      success: true,
      allowed,
      denied,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      allowed,
      denied,
      error: errorMessage,
    };
  }
}
