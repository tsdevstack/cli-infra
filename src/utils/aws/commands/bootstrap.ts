/**
 * AWS Bootstrap Handler
 *
 * Verifies credentials, checks permissions, and attempts to grant missing ones.
 */

import { getContext } from '../../../context';
import { verifyAWSCredentials } from '../verify-aws-credentials';
import { checkAWSPermissions } from '../check-aws-permissions';
import { grantAWSPermissions } from '../grant-aws-permissions';
import type { AWSCommandContext } from './types';

/**
 * Bootstrap AWS - verify credentials and permissions
 */
export async function awsBootstrap(ctx: AWSCommandContext): Promise<void> {
  const { logger, CliError } = getContext();

  // Step 1: Verify credentials
  logger.info('Step 1/3: Verifying AWS credentials...');
  const verifyResult = await verifyAWSCredentials(ctx.credentials);

  if (!verifyResult.success || !verifyResult.identity) {
    throw new CliError(
      `AWS credentials verification failed: ${verifyResult.error}`,
      'infra:bootstrap',
      'Check your AWS credentials file or environment variables',
    );
  }

  const { identity } = verifyResult;
  logger.info(`  Account: ${identity.accountId}`);
  logger.info(
    `  Principal: ${identity.principalName} (${identity.principalType})`,
  );
  logger.newline();

  // Step 2: Check permissions
  logger.info('Step 2/3: Checking required permissions...');
  const checkResult = await checkAWSPermissions(ctx.credentials, identity.arn);

  if (!checkResult.success) {
    // SimulatePrincipalPolicy failed - might not have iam:SimulatePrincipalPolicy permission
    // This is not fatal - we can continue and try to grant permissions anyway
    logger.warn(`  Could not check permissions: ${checkResult.error}`);
    logger.info('  Continuing with permission granting attempt...');
    logger.newline();
  } else {
    const totalActions = checkResult.allowed.length + checkResult.denied.length;
    logger.info(
      `  Allowed: ${checkResult.allowed.length}/${totalActions} actions`,
    );

    if (checkResult.denied.length > 0) {
      logger.warn(`  Denied: ${checkResult.denied.length} actions`);
    }
    logger.newline();
  }

  // Step 3: Grant missing permissions if needed
  const hasMissingPermissions =
    checkResult.denied.length > 0 || !checkResult.success;

  if (hasMissingPermissions) {
    logger.info('Step 3/3: Attempting to grant missing permissions...');
    const grantResult = await grantAWSPermissions(ctx.credentials, identity);

    if (grantResult.policiesAttached.length > 0) {
      logger.info(`  Attached ${grantResult.policiesAttached.length} policies`);
      for (const policy of grantResult.policiesAttached) {
        const policyName = policy.split('/').pop();
        logger.info(`    + ${policyName}`);
      }
    }

    if (grantResult.policiesFailed.length > 0) {
      logger.warn(
        `  Failed to attach ${grantResult.policiesFailed.length} policies`,
      );

      // If we couldn't attach any policies and have denied permissions, show detailed error
      if (
        grantResult.policiesAttached.length === 0 &&
        checkResult.denied.length > 0
      ) {
        logger.newline();
        logger.error('Missing permissions (cannot grant automatically):');
        for (const action of checkResult.denied.slice(0, 10)) {
          logger.error(`  - ${action}`);
        }
        if (checkResult.denied.length > 10) {
          logger.error(`  ... and ${checkResult.denied.length - 10} more`);
        }
        logger.newline();

        throw new CliError(
          'Cannot automatically grant required permissions',
          'infra:bootstrap',
          'Ask your AWS admin to grant the listed permissions, or use credentials with IAM admin access',
        );
      }
    }
  } else {
    logger.info('Step 3/3: All permissions already granted');
  }

  logger.newline();
  logger.complete('Bootstrap complete!');
  logger.info('AWS credentials verified and permissions checked.');
  logger.newline();
}
