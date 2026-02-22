/**
 * infra:run-db-migrate Command
 *
 * Applies pending database migrations for a service by running
 * `prisma migrate deploy` in a Cloud Run Job (GCP) or ECS Task (AWS).
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpDbMigrateRun } from '../utils/gcp/commands';
import { awsDbMigrateRun } from '../utils/aws/commands';
import { azureDbMigrateRun } from '../utils/azure/commands';
import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from 'tsdevstack/plugin';

interface InfraDbMigrateRunOptions {
  env?: string;
  service: string;
  tag?: string;
}

/**
 * Apply pending database migrations
 */
export async function infraDbMigrateRun(
  options: InfraDbMigrateRunOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();

  logger.newline();
  logger.info('Applying database migrations...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:run-db-migrate');
  const { projectRoot, targetEnv, provider, projectName } = ctx;

  const config = loadFrameworkConfig();

  // Find the service
  const service = config.services.find((s) => s.name === options.service);
  if (!service) {
    const allServices = config.services.map((s) => s.name).join(', ');
    throw new CliError(
      `Service "${options.service}" not found`,
      'infra:run-db-migrate',
      `Available services: ${allServices}`,
    );
  }

  if (!service.hasDatabase) {
    throw new CliError(
      `Service "${options.service}" does not have a database`,
      'infra:run-db-migrate',
      'Only services with hasDatabase: true can run migrations',
    );
  }

  // Verify terraform directory exists
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'infra:run-db-migrate',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  if (provider === 'gcp') {
    await gcpDbMigrateRun({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as GCPCredentials,
      service,
      imageTag: options.tag,
    });
  } else if (provider === 'aws') {
    await awsDbMigrateRun({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as AWSCredentials,
      service,
      imageTag: options.tag,
    });
  } else if (provider === 'azure') {
    await azureDbMigrateRun({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as AzureCredentials,
      service,
      imageTag: options.tag,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:run-db-migrate',
      'Supported providers: gcp, aws, azure',
    );
  }
}
