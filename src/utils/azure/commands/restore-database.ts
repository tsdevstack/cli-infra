/**
 * Restore a service's database from a saved file (Azure)
 */

import inquirer from 'inquirer';
import {
  buildAzureTerraformEnv,
  DB_EXPORT_REASONS,
} from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { initTerraformBeforeChanges } from '../../terraform';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { databaseExists } from '../discovery';
import { resolveAzureNaming } from '../naming/resolve-azure-naming';
import { resolvePostgresServerName } from '../resolve-postgres-server-name';
import { getAzureDbExports } from '../database-export/get-azure-db-exports';
import { listAzureDbExports } from '../database-export/list-azure-db-exports';
import { runAzureDatabaseJob } from '../database-export/run-azure-database-job';
import { buildDbExportFileName } from '../../database-export/build-db-export-file-name';
import { chooseDbExportFile } from '../../database-export/choose-db-export-file';
import { chooseDbExportService } from '../../database-export/choose-db-export-service';
import { formatDbExportFile } from '../../database-export/format-db-export-file';
import { logRestoreDatabaseNextSteps } from '../../display/log-restore-database-next-steps';
import type { AzureCommandContext } from './types';

export interface AzureRestoreDatabaseParams {
  /** Left out in a terminal: the services with saved files are listed */
  serviceName: string | undefined;
  ctx: AzureCommandContext;
  runningInCI: boolean;
  /** --file: the saved file's name in the container */
  fileOption?: string;
}

/**
 * Replaces the service's database on the PostgreSQL Flexible Server with a
 * saved file. The service must be deployed (its database exists). The
 * current contents are saved first ({service}/{time}-before-restore.dump),
 * so the restore can be undone. db-init does the work in the Container Apps
 * environment. The delete lock on the server stays: it guards the server's
 * API, and the restore works in SQL.
 */
export async function azureRestoreDatabase(
  params: AzureRestoreDatabaseParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { ctx, runningInCI } = params;
  const { credentials, projectName, targetEnv } = ctx;
  const resourceGroupName = `${projectName}-${targetEnv}-rg`;

  // The storage and db-init's settings are Terraform outputs
  await initTerraformBeforeChanges({
    projectRoot: ctx.projectRoot,
    targetEnv,
    env: buildAzureTerraformEnv(buildRuntime(), credentials),
    command: 'infra:restore-database',
  });
  const exports = getAzureDbExports(ctx);
  if (!exports) {
    throw new CliError(
      'This environment has no storage for saved databases yet',
      'infra:restore-database',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first (it makes the storage).`,
    );
  }

  // Without a name, the services with saved files (only those can be
  // restored)
  const serviceName =
    params.serviceName ??
    (await chooseDbExportService(
      await listAzureDbExports({ exports, resourceGroupName, credentials }),
    ));

  const database = await databaseExists({
    databaseName: serviceName,
    serverName: resolvePostgresServerName(
      projectName,
      targetEnv,
      loadInfrastructureConfig(),
      await resolveAzureNaming(credentials, projectName, targetEnv),
    ).name,
    resourceGroupName,
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
    files: await listAzureDbExports({
      exports,
      resourceGroupName,
      serviceName,
      credentials,
    }),
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
  await runAzureDatabaseJob({
    ctx,
    mode: 'export',
    serviceName,
    file: beforeRestore,
  });
  logger.success(`Saved: ${exports.containerUrl}/${beforeRestore}`);
  logger.newline();

  logger.info(`Restoring ${file.name}...`);
  await runAzureDatabaseJob({
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
