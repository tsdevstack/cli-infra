/**
 * Set up each database service's owner and app role (GCP infra:deploy)
 */

import path from 'node:path';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';
import { setSecretViaCli } from '../credentials/set-secret-via-cli';
import { buildAndPushGcpDbInit } from './build-and-push-gcp-db-init';
import { ensureGcpDatabaseUrlSecrets } from './ensure-gcp-database-url-secrets';
import { runGcpDbInit } from './run-gcp-db-init';
import { getTerraformOutput } from './terraform';

export interface SetUpGcpDatabaseUsersOptions {
  /** The environment's Terraform folder (outputs, the generated db-init/) */
  terraformDir: string;
  tfEnv: Record<string, string>;
  projectName: string;
  targetEnv: string;
  credentials: GCPCredentials;
  /** Each database service's owner password (Terraform's google_sql_user) */
  ownerPasswords: Record<string, string>;
}

/**
 * After Terraform:
 * 1. MIGRATION_DATABASE_URL: the owner's URL with Terraform's password (the
 *    owner is Terraform's on GCP, so the CLI writes it)
 * 2. DATABASE_URL secrets created where missing (db-init only adds versions)
 * 3. db-init built, pushed and run in the VPC: it takes away what Cloud SQL
 *    gives the owner, creates the app role and moves DATABASE_URL to it
 *
 * @throws CliError when a step fails
 */
export async function setUpGcpDatabaseUsers(
  options: SetUpGcpDatabaseUsersOptions,
): Promise<void> {
  const { logger, CliError, MIGRATION_DATABASE_URL_KEY } = getContext();
  const serviceNames = Object.keys(options.ownerPasswords);

  logger.info('Setting up database users...');
  const dbHost = getTerraformOutput(
    options.terraformDir,
    'database_private_ip',
    options.tfEnv,
  );

  for (const serviceName of serviceNames) {
    const password = encodeURIComponent(options.ownerPasswords[serviceName]);
    try {
      setSecretViaCli(
        MIGRATION_DATABASE_URL_KEY,
        `postgresql://${serviceName}:${password}@${dbHost}:5432/${serviceName}`,
        options.targetEnv,
        serviceName,
      );
    } catch (error) {
      throw new CliError(
        `Could not write ${MIGRATION_DATABASE_URL_KEY} for ${serviceName}`,
        'Database users',
        error instanceof Error ? error.message : String(error),
      );
    }
    logger.success(`  ✓ ${MIGRATION_DATABASE_URL_KEY} for ${serviceName}`);
  }

  await ensureGcpDatabaseUrlSecrets({
    projectName: options.projectName,
    credentials: options.credentials,
    serviceNames,
  });

  const registryUrl = getTerraformOutput(
    options.terraformDir,
    'artifact_registry_url',
    options.tfEnv,
  );
  await buildAndPushGcpDbInit({
    dbInitDir: path.join(options.terraformDir, 'db-init'),
    imageUri: `${registryUrl}/db-init:latest`,
    credentials: options.credentials,
  });

  await runGcpDbInit({
    mode: 'init',
    terraformDir: options.terraformDir,
    tfEnv: options.tfEnv,
    projectName: options.projectName,
    targetEnv: options.targetEnv,
    credentials: options.credentials,
    serviceNames,
  });
}
