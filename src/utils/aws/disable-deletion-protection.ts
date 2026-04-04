/**
 * Disable RDS Deletion Protection
 *
 * Uses @aws-sdk/client-rds to disable deletion protection on an RDS instance.
 * This must be done before `terraform destroy` can delete the instance.
 */

import {
  RDSClient,
  DescribeDBInstancesCommand,
  ModifyDBInstanceCommand,
} from '@aws-sdk/client-rds';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from './build-aws-client-config';

export interface DisableDeletionProtectionOptions {
  instanceIdentifier: string;
  credentials: AWSCredentials;
}

export interface DisableDeletionProtectionResult {
  success: boolean;
  wasAlreadyDisabled?: boolean;
  error?: string;
}

/**
 * Disable deletion protection on an RDS instance
 *
 * Checks current state first — only modifies if protection is enabled.
 */
export async function disableDeletionProtection(
  options: DisableDeletionProtectionOptions,
): Promise<DisableDeletionProtectionResult> {
  const clientConfig = buildAWSClientConfig(options.credentials);
  const rds = new RDSClient(clientConfig);

  try {
    // Check current state
    const describeResponse = await rds.send(
      new DescribeDBInstancesCommand({
        DBInstanceIdentifier: options.instanceIdentifier,
      }),
    );

    const instance = describeResponse.DBInstances?.[0];
    if (!instance) {
      return { success: true, wasAlreadyDisabled: true };
    }

    if (!instance.DeletionProtection) {
      return { success: true, wasAlreadyDisabled: true };
    }

    // Disable deletion protection
    await rds.send(
      new ModifyDBInstanceCommand({
        DBInstanceIdentifier: options.instanceIdentifier,
        DeletionProtection: false,
        ApplyImmediately: true,
      }),
    );

    return { success: true };
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };

    // Instance not found — nothing to disable
    if (err.name === 'DBInstanceNotFoundFault') {
      return { success: true, wasAlreadyDisabled: true };
    }

    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}
