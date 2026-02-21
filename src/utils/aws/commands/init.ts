/**
 * AWS Init Handler
 *
 * Initializes AWS infrastructure by creating the Terraform state backend.
 */

import { getContext } from '../../../context';
import { createStateBackend } from '../bootstrap/create-state-backend';
import type { AWSCommandContext } from './types';

/**
 * Initialize AWS infrastructure (create state backend)
 */
export async function awsInit(ctx: AWSCommandContext): Promise<void> {
  const { logger, CliError } = getContext();

  logger.info('Creating Terraform state backend...');
  logger.newline();

  const result = await createStateBackend({
    projectName: ctx.projectName,
    accountId: ctx.credentials.accountId,
    credentials: ctx.credentials,
  });

  if (!result.success) {
    throw new CliError(
      `Failed to create state backend: ${result.error}`,
      'infra:init',
      'Check your AWS credentials and permissions',
    );
  }

  if (result.bucketCreated) {
    logger.success(`Created S3 bucket: ${result.bucketName}`);
  } else {
    logger.success(`S3 bucket already exists: ${result.bucketName}`);
  }

  if (result.tableCreated) {
    logger.success(`Created DynamoDB table: ${result.tableName}`);
  } else {
    logger.success(`DynamoDB table already exists: ${result.tableName}`);
  }

  logger.newline();
  logger.info('Infrastructure initialized successfully!');
  logger.newline();
  logger.info('Next steps:');
  logger.info(
    `  1. Generate config: npx tsdevstack infra:generate --env ${ctx.targetEnv}`,
  );
  logger.info(
    `  2. Plan changes: npx tsdevstack infra:plan --env ${ctx.targetEnv}`,
  );
  logger.info(
    `  3. Deploy: npx tsdevstack infra:deploy --env ${ctx.targetEnv}`,
  );
  logger.newline();
}
