/**
 * Restore a service's database from a saved file (AWS)
 */

import inquirer from 'inquirer';
import {
  buildAwsTerraformEnv,
  DB_EXPORT_REASONS,
} from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { initTerraformBeforeChanges } from '../../terraform';
import { listSecretsByPrefix } from '../discovery';
import { getAwsDbExportsBucket } from '../database-export/get-aws-db-exports-bucket';
import { listAwsDbExports } from '../database-export/list-aws-db-exports';
import { runAwsDatabaseJob } from '../database-export/run-aws-database-job';
import { buildDbExportFileName } from '../../database-export/build-db-export-file-name';
import { chooseDbExportFile } from '../../database-export/choose-db-export-file';
import { chooseDbExportService } from '../../database-export/choose-db-export-service';
import { formatDbExportFile } from '../../database-export/format-db-export-file';
import { logRestoreDatabaseNextSteps } from '../../display/log-restore-database-next-steps';
import type { AWSCommandContext } from './types';

export interface AwsRestoreDatabaseParams {
  /** Left out in a terminal: the services with saved files are listed */
  serviceName: string | undefined;
  ctx: AWSCommandContext;
  runningInCI: boolean;
  /** --file: the saved file's name in the bucket */
  fileOption?: string;
}

/**
 * Replaces the service's database on the RDS instance with a saved file.
 * The service must be deployed (its database exists). The current contents
 * are saved first ({service}/{time}-before-restore.dump), so the restore
 * can be undone. db-init does the work in the private subnets.
 */
export async function awsRestoreDatabase(
  params: AwsRestoreDatabaseParams,
): Promise<void> {
  const { logger, CliError, buildSecretName } = getContext();
  const { ctx, runningInCI } = params;
  const { credentials, projectName, targetEnv } = ctx;

  // The bucket and where db-init runs are Terraform outputs
  await initTerraformBeforeChanges({
    projectRoot: ctx.projectRoot,
    targetEnv,
    env: buildAwsTerraformEnv(buildRuntime(), credentials),
    command: 'infra:restore-database',
  });
  const bucket = getAwsDbExportsBucket(ctx);
  if (!bucket) {
    throw new CliError(
      'This environment has no bucket for saved databases yet',
      'infra:restore-database',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first (it makes the bucket).`,
    );
  }

  // Without a name, the services with saved files (only those can be
  // restored)
  const serviceName =
    params.serviceName ??
    (await chooseDbExportService(
      await listAwsDbExports({ bucket, credentials }),
    ));

  // RDS has no list of a server's databases: db-init writes DATABASE_URL
  // right after it makes the database
  const secrets = await listSecretsByPrefix({
    prefix: `${projectName}-${serviceName}-`,
    credentials,
  });
  if (!secrets.success) {
    throw new CliError(
      `Could not check the database of ${serviceName}: ${secrets.error ?? 'unknown error'}`,
      'infra:restore-database',
      'Nothing was changed.',
    );
  }
  const databaseUrl = buildSecretName(projectName, serviceName, 'DATABASE_URL');
  if (!secrets.secrets.some((secret) => secret.name === databaseUrl)) {
    throw new CliError(
      `${serviceName} has no database in ${targetEnv}`,
      'infra:restore-database',
      `Deploy the service first: npx tsdevstack cloud-secrets:push --env ${targetEnv}, then npx tsdevstack infra:deploy --env ${targetEnv}`,
    );
  }

  const file = await chooseDbExportFile({
    serviceName,
    files: await listAwsDbExports({ bucket, serviceName, credentials }),
    fileOption: params.fileOption,
    interactive: !runningInCI,
  });

  logger.newline();
  logger.warn(
    `This replaces everything in the database "${serviceName}" (${targetEnv}) with:`,
  );
  logger.info(`  ${formatDbExportFile(file)}  ${file.name}`);
  logger.info(
    'The current contents are saved first, so it can be undone. The service gets database errors while it runs.',
  );
  logger.newline();
  if (!runningInCI) {
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: `Restore the database of ${serviceName}?`,
        default: false,
      },
    ]);
    if (!proceed) {
      logger.info('Nothing was changed.');
      return;
    }
  }

  const beforeRestore = buildDbExportFileName(
    serviceName,
    DB_EXPORT_REASONS.beforeRestore,
  );
  logger.info('Saving the current contents...');
  await runAwsDatabaseJob({
    ctx,
    mode: 'export',
    serviceName,
    file: beforeRestore,
  });
  logger.success(`Saved: s3://${bucket}/${beforeRestore}`);
  logger.newline();

  logger.info(`Restoring ${file.name}...`);
  await runAwsDatabaseJob({
    ctx,
    mode: 'restore',
    serviceName,
    file: file.name,
  });
  logger.newline();
  logger.success(`✔ The database of ${serviceName} is restored (${targetEnv})`);
  logger.newline();
  logRestoreDatabaseNextSteps(serviceName, targetEnv, beforeRestore);
}
