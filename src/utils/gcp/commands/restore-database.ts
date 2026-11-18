/**
 * Restore a service's database from a saved file (GCP)
 */

import inquirer from 'inquirer';
import {
  buildGcpTerraformEnv,
  DB_EXPORT_REASONS,
} from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { initTerraformBeforeChanges } from '../../terraform';
import { databaseExists } from '../discovery';
import { getGcpDbExportsBucket } from '../database-export/get-gcp-db-exports-bucket';
import { listGcpDbExports } from '../database-export/list-gcp-db-exports';
import { runGcpDatabaseJob } from '../database-export/run-gcp-database-job';
import { buildDbExportFileName } from '../../database-export/build-db-export-file-name';
import { chooseDbExportFile } from '../../database-export/choose-db-export-file';
import { chooseDbExportService } from '../../database-export/choose-db-export-service';
import { formatDbExportFile } from '../../database-export/format-db-export-file';
import { logRestoreDatabaseNextSteps } from '../../display/log-restore-database-next-steps';
import type { GCPCommandContext } from './types';

export interface GcpRestoreDatabaseParams {
  /** Left out in a terminal: the services with saved files are listed */
  serviceName: string | undefined;
  ctx: GCPCommandContext;
  runningInCI: boolean;
  /** --file: the saved file's name in the bucket */
  fileOption?: string;
}

/**
 * Replaces the service's Cloud SQL database with a saved file. The service
 * must be deployed (its database exists). The current contents are saved
 * first ({service}/{time}-before-restore.dump), so the restore can be
 * undone. db-init does the work inside the VPC.
 */
export async function gcpRestoreDatabase(
  params: GcpRestoreDatabaseParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { ctx, runningInCI } = params;
  const { credentials, projectName, targetEnv } = ctx;

  // The bucket and db-init's settings are Terraform outputs
  await initTerraformBeforeChanges({
    projectRoot: ctx.projectRoot,
    targetEnv,
    env: buildGcpTerraformEnv(buildRuntime(), credentials),
    command: 'infra:restore-database',
  });
  const bucket = getGcpDbExportsBucket(ctx);
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
      await listGcpDbExports({ bucket, credentials }),
    ));

  const database = await databaseExists({
    databaseName: serviceName,
    instanceName: `${projectName}-postgres`,
    projectId: credentials.project_id,
    credentials,
  });
  if (!database.exists) {
    throw new CliError(
      `${serviceName} has no database in ${targetEnv}`,
      'infra:restore-database',
      database.error ??
        `Deploy the service first: npx tsdevstack cloud-secrets:push --env ${targetEnv}, then npx tsdevstack infra:deploy --env ${targetEnv}`,
    );
  }

  const file = await chooseDbExportFile({
    serviceName,
    files: await listGcpDbExports({ bucket, serviceName, credentials }),
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
  await runGcpDatabaseJob({
    ctx,
    mode: 'export',
    serviceName,
    file: beforeRestore,
  });
  logger.success(`Saved: gs://${bucket}/${beforeRestore}`);
  logger.newline();

  logger.info(`Restoring ${file.name}...`);
  await runGcpDatabaseJob({
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
