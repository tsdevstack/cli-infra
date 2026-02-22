/**
 * infra:plan-db-migrate Command
 *
 * Shows pending database migrations for a service by running
 * `prisma migrate status` in a Cloud Run Job (GCP) or ECS Task (AWS).
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpDbMigratePlan } from '../utils/gcp/commands';
import { awsDbMigratePlan } from '../utils/aws/commands';
import { azureDbMigratePlan } from '../utils/azure/commands';
import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from 'tsdevstack/plugin';

interface InfraDbMigratePlanOptions {
  env?: string;
  service: string;
}

/**
 * Show pending database migrations
 */
export async function infraDbMigratePlan(
  options: InfraDbMigratePlanOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();

  logger.newline();
  logger.info('Checking pending database migrations...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:plan-db-migrate');
  const { projectRoot, targetEnv, provider, projectName } = ctx;

  const config = loadFrameworkConfig();

  // Find the service
  const service = config.services.find((s) => s.name === options.service);
  if (!service) {
    const allServices = config.services.map((s) => s.name).join(', ');
    throw new CliError(
      `Service "${options.service}" not found`,
      'infra:plan-db-migrate',
      `Available services: ${allServices}`,
    );
  }

  if (!service.hasDatabase) {
    throw new CliError(
      `Service "${options.service}" does not have a database`,
      'infra:plan-db-migrate',
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
      'infra:plan-db-migrate',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  if (provider === 'gcp') {
    await gcpDbMigratePlan({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as GCPCredentials,
      service,
    });
  } else if (provider === 'aws') {
    await awsDbMigratePlan({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as AWSCredentials,
      service,
    });
  } else if (provider === 'azure') {
    await azureDbMigratePlan({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as AzureCredentials,
      service,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:plan-db-migrate',
      'Supported providers: gcp, aws, azure',
    );
  }
}
