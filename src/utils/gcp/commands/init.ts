/**
 * GCP Init Handler
 */

import { getContext } from '../../../context';
import { createBucket } from '../create-bucket';
import { getGcsLocationFromRegion } from '../get-gcs-location-from-region';
import type { GCPCommandContext } from './types';

/**
 * Initialize GCP infrastructure (create state bucket)
 */
export async function gcpInit(ctx: GCPCommandContext): Promise<void> {
  const { logger, CliError } = getContext();

  const bucketName = `${ctx.projectName}-tf-state-${ctx.credentials.project_id}`;

  logger.info(`Creating state bucket: ${bucketName}`);
  logger.newline();

  const result = await createBucket({
    bucketName,
    credentials: ctx.credentials,
    location: getGcsLocationFromRegion(ctx.credentials.region),
    versioning: true,
    labels: {
      purpose: 'tf-state',
      environment: ctx.targetEnv,
    },
  });

  if (!result.success) {
    throw new CliError(
      `Failed to create bucket: ${result.error}`,
      'infra:init',
      'Check your GCP credentials and permissions',
    );
  }

  if (result.isNew) {
    logger.success(`✓ Created bucket: ${bucketName}`);
  } else {
    logger.success(`✓ Bucket already exists: ${bucketName}`);
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
