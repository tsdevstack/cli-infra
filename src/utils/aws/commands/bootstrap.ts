/**
 * AWS Bootstrap Handler
 *
 * Verifies credentials and checks that all required permissions are available.
 * Does NOT attempt to grant permissions — the user must configure IAM before running bootstrap.
 */

import { getContext } from '../../../context';
import { verifyAWSCredentials } from '../verify-aws-credentials';
import { checkAWSPermissions } from '../check-aws-permissions';
import type { AWSCommandContext } from './types';

/**
 * Bootstrap AWS - verify credentials and check permissions
 */
export async function awsBootstrap(ctx: AWSCommandContext): Promise<void> {
  const { logger, CliError } = getContext();

  // Step 1: Verify credentials
  logger.info('Step 1/2: Verifying AWS credentials...');
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
  logger.info('Step 2/2: Checking required permissions...');
  const checkResult = await checkAWSPermissions(ctx.credentials, identity.arn);

  if (!checkResult.success) {
    // SimulatePrincipalPolicy failed - might not have iam:SimulatePrincipalPolicy permission
    // or the ARN format is not supported (e.g., assumed-role ARNs)
    logger.warn(`  Could not verify permissions: ${checkResult.error}`);
    logger.info(
      '  Skipping permission check — deployment will fail if permissions are missing.',
    );
    logger.newline();
  } else {
    const totalActions = checkResult.allowed.length + checkResult.denied.length;
    logger.info(
      `  Allowed: ${checkResult.allowed.length}/${totalActions} actions`,
    );

    if (checkResult.denied.length > 0) {
      logger.newline();
      logger.error('Missing permissions:');
      for (const action of checkResult.denied.slice(0, 20)) {
        logger.error(`  - ${action}`);
      }
      if (checkResult.denied.length > 20) {
        logger.error(`  ... and ${checkResult.denied.length - 20} more`);
      }
      logger.newline();

      throw new CliError(
        `Missing ${checkResult.denied.length} required IAM permissions`,
        'infra:bootstrap',
        'Add the missing permissions to your IAM user or role. See the AWS CI/CD guide for the required inline policy.',
      );
    }
    logger.newline();
  }

  logger.complete('Bootstrap complete!');
  logger.info('AWS credentials verified and permissions checked.');
  logger.newline();
}
