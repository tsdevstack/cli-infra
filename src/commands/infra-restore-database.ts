/**
 * infra:restore-database - Replace a service's database with a saved file
 *
 * The file is one infra:remove-service saved before it dropped the
 * database, or one a restore saved before it replaced the contents.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpRestoreDatabase } from '../utils/gcp/commands/restore-database';
import { awsRestoreDatabase } from '../utils/aws/commands/restore-database';
import { azureRestoreDatabase } from '../utils/azure/commands/restore-database';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands/types';
import type { AzureCommandContext } from '../utils/azure/commands/types';

interface InfraRestoreDatabaseOptions {
  env?: string;
  /** The saved file's name in the bucket (default: the newest from a removal) */
  file?: string;
  /** Skip the confirmation (required in CI) */
  confirm?: boolean;
}

/**
 * Restore a service's database from a saved file
 */
export async function infraRestoreDatabase(
  serviceName: string | undefined,
  options: InfraRestoreDatabaseOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();

  logger.newline();
  logger.warn('Restore a Service Database');
  logger.newline();

  const runningInCI = isCIEnv();
  if (runningInCI && !serviceName) {
    throw new CliError(
      'Service name required in CI mode',
      'infra:restore-database',
      'Specify it as argument: infra:restore-database <service-name>',
    );
  }
  if (runningInCI && !options.confirm) {
    throw new CliError(
      '--confirm flag required in CI mode',
      'infra:restore-database',
      'Add --confirm: the restore replaces the database contents without asking',
    );
  }

  const ctx = await setupInfraCommand(options, 'infra:restore-database');

  if (ctx.provider === 'gcp') {
    await gcpRestoreDatabase({
      serviceName,
      ctx: ctx as GCPCommandContext,
      runningInCI,
      fileOption: options.file,
    });
  } else if (ctx.provider === 'aws') {
    await awsRestoreDatabase({
      serviceName,
      ctx: ctx as AWSCommandContext,
      runningInCI,
      fileOption: options.file,
    });
  } else if (ctx.provider === 'azure') {
    await azureRestoreDatabase({
      serviceName,
      ctx: ctx as AzureCommandContext,
      runningInCI,
      fileOption: options.file,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:restore-database',
      'Supported providers: gcp, aws, azure',
    );
  }
}
