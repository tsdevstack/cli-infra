/**
 * AWS Destroy Handler
 */

import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { executeTerraform } from '../terraform';
import {
  buildAwsTerraformEnv,
  checkTerraformInstalled,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { disableDeletionProtection } from '../disable-deletion-protection';
import { disableAlbDeletionProtection } from '../disable-alb-deletion-protection';
import type { AWSCommandContext, DestroyOptions } from './types';
import { deleteCloudWatchLogGroup } from '../delete';
import { buildAwsMigrationNames } from '../build-aws-migration-names';
import { AWS_VPC_FLOW_LOG_GROUP_PREFIX } from '../../../constants';

/**
 * Check if any service in the project has a database
 */
function projectHasDatabase(): boolean {
  const { loadFrameworkConfig } = getContext();
  try {
    const config = loadFrameworkConfig();
    return config.services.some((s) => s.hasDatabase);
  } catch {
    return false;
  }
}

/**
 * Destroy AWS infrastructure
 */
export async function awsDestroy(
  ctx: AWSCommandContext,
  options: DestroyOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  const runtime = buildRuntime();
  checkTerraformInstalled(runtime);

  const outputDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );

  if (!fs.existsSync(outputDir)) {
    throw new CliError(
      `Configuration directory not found: ${outputDir}`,
      'infra:destroy',
      'Run: npx tsdevstack infra:deploy first to create infrastructure',
    );
  }

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`AWS Region: ${ctx.credentials.region}`);
  logger.newline();

  const hasDatabase = projectHasDatabase();

  // Confirm
  if (!options.autoApprove && !ctx.runningInCI) {
    logger.warn('This will DESTROY all infrastructure resources!');
    logger.warn(
      'Storage buckets (uploaded files), logs and the CloudTrail audit trail are deleted too.',
    );
    logger.newline();

    if (hasDatabase) {
      logger.warn(
        'This includes the RDS PostgreSQL instance (ALL databases for ALL services).',
      );
      logger.warn('DATABASE DATA WILL BE PERMANENTLY LOST.');
      logger.newline();
      logger.info('Back up your databases before proceeding:');
      logger.info('  RDS Console → Snapshots → Create snapshot');
      logger.info('  Or use pg_dump for individual databases.');
      logger.newline();
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to destroy the ${ctx.targetEnv} environment?`,
        default: false,
      },
    ]);

    if (!confirm) {
      logger.info('Destroy cancelled by user');
      return;
    }
  }

  // Disable deletion protection before terraform destroy
  logger.info('Disabling load balancer deletion protection...');

  const albResult = await disableAlbDeletionProtection({
    loadBalancerName: `${ctx.projectName}-alb`,
    credentials: ctx.credentials,
  });

  if (!albResult.success) {
    throw new CliError(
      `Failed to disable load balancer deletion protection: ${albResult.error}`,
      'infra:destroy',
      'Disable deletion protection manually via EC2 Console → Load Balancers → Attributes, then retry',
    );
  }

  if (albResult.wasAlreadyDisabled) {
    logger.info('  Deletion protection already disabled.');
  } else {
    logger.info('  Deletion protection disabled.');
  }
  logger.newline();

  if (hasDatabase) {
    const instanceIdentifier = `${ctx.projectName}-db`;
    logger.info('Disabling database deletion protection...');

    const result = await disableDeletionProtection({
      instanceIdentifier,
      credentials: ctx.credentials,
    });

    if (!result.success) {
      throw new CliError(
        `Failed to disable deletion protection: ${result.error}`,
        'infra:destroy',
        'Disable deletion protection manually via RDS Console, then retry',
      );
    }

    if (result.wasAlreadyDisabled) {
      logger.info('  Deletion protection already disabled.');
    } else {
      logger.info('  Deletion protection disabled.');
    }
    logger.newline();
  }

  // Build Terraform environment
  const tfEnv = buildAwsTerraformEnv(runtime, ctx.credentials);

  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: outputDir,
    env: tfEnv,
    reconfigure: true,
  });

  if (!initResult.success) {
    throw new CliError(
      'Initialization failed',
      'infra:destroy',
      initResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.info('Destroying resources...');
  logger.newline();

  const destroyResult = await executeTerraform('destroy', {
    workDir: outputDir,
    autoApprove: true,
    env: tfEnv,
  });

  if (!destroyResult.success) {
    throw new CliError(
      'Destroy failed',
      'infra:destroy',
      destroyResult.error || 'Check the output above for details',
    );
  }

  // The migration runs' log groups: the CLI creates them, not Terraform, so
  // the destroy above leaves them. One that won't delete only warns.
  let databaseServices: string[] = [];
  try {
    databaseServices = getContext()
      .loadFrameworkConfig()
      .services.filter((s) => s.hasDatabase)
      .map((s) => s.name);
  } catch {
    // No readable config.json: nothing to name the groups by
  }
  for (const serviceName of databaseServices) {
    // Today's name and the one without the project, from earlier deploys
    const { logGroupName, legacyLogGroupName } = buildAwsMigrationNames(
      ctx.projectName,
      serviceName,
    );
    for (const name of [logGroupName, legacyLogGroupName]) {
      const result = await deleteCloudWatchLogGroup({
        logGroupName: name,
        credentials: ctx.credentials,
      });
      if (!result.success) {
        logger.warn(`Could not delete ${name}: ${result.error}`);
      }
    }
  }

  // The VPC flow log's group again: records still on their way after the
  // destroy deleted it can make it anew (its role may create log groups, as
  // AWS asks), and the next deploy then fails on a group that exists
  const flowLogGroup = `${AWS_VPC_FLOW_LOG_GROUP_PREFIX}${ctx.projectName}`;
  const flowLogResult = await deleteCloudWatchLogGroup({
    logGroupName: flowLogGroup,
    credentials: ctx.credentials,
  });
  if (!flowLogResult.success) {
    logger.warn(`Could not delete ${flowLogGroup}: ${flowLogResult.error}`);
  }

  logger.newline();
  logger.success('Infrastructure destroyed successfully!');
  logger.newline();

  // Post-destroy recovery hints
  if (hasDatabase) {
    logger.info('Data recovery:');
    logger.info(
      `  Final snapshot: ${ctx.projectName}-db-final-<suffix> (RDS Console → Snapshots)`,
    );
    logger.info(
      '  The master password secret is deleted with the environment: after restoring the snapshot, set a new master password (RDS Console → Modify).',
    );
    logger.newline();
  }
}
