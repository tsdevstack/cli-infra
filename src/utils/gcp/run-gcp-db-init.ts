/**
 * Run the db-init Cloud Run job (GCP)
 */

import {
  DB_EXPORT_JOB_TIMEOUT_SECONDS,
  executeCloudRunJob,
} from '@tsdevstack/infra-core';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';
import { GCP_DB_INIT_JOB_SUFFIX } from '../../constants';
import { buildRuntime } from '../build-runtime';
import { getTerraformOutput } from './terraform';

export interface RunGcpDbInitOptions {
  /**
   * init: set up the roles and DATABASE_URL; remove: drop the database and
   * the roles; export: save the database to exportFile; restore: replace
   * the database with exportFile
   */
  mode: 'init' | 'remove' | 'export' | 'restore';
  /** The environment's Terraform folder (for its outputs) */
  terraformDir: string;
  tfEnv: Record<string, string>;
  projectName: string;
  targetEnv: string;
  credentials: GCPCredentials;
  /** Services to set up or whose roles to drop (export, restore: one) */
  serviceNames: readonly string[];
  /** export and restore: the file in the exports bucket */
  exportFile?: string;
}

/**
 * Runs {project}-db-init (the image infra:deploy pushed) inside the VPC as
 * the database jobs' service account: it logs in as Cloud SQL's postgres
 * user (password from Secret Manager) and sets up each service's owner and
 * app role, drops them with the database, or saves or restores a service's
 * database (the exports bucket, with a 1-hour limit).
 *
 * @throws CliError with the job's logs when it fails
 */
export async function runGcpDbInit(
  options: RunGcpDbInitOptions,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { terraformDir, tfEnv, credentials } = options;

  const output = (name: string): string =>
    getTerraformOutput(terraformDir, name, tfEnv);
  const registryUrl = output('artifact_registry_url');

  logger.info(
    `Running db-init (${options.mode}) for ${options.serviceNames.join(', ')}...`,
  );
  const result = await executeCloudRunJob(buildRuntime(), {
    projectId: credentials.project_id,
    region: credentials.region,
    jobName: `${options.projectName}${GCP_DB_INIT_JOB_SUFFIX}`,
    imageUri: `${registryUrl}/db-init:latest`,
    command: ['node', 'index.js'],
    vpcNetwork: output('vpc_id'),
    vpcSubnet: output('subnet_id'),
    secretEnv: { DB_ADMIN_PASSWORD: output('db_admin_password_secret') },
    env: {
      MODE: options.mode,
      PROJECT: options.projectName,
      ENVIRONMENT: options.targetEnv,
      GCP_PROJECT_ID: credentials.project_id,
      DB_HOST: output('database_private_ip'),
      SERVICES: JSON.stringify(options.serviceNames),
      ...(options.exportFile && {
        EXPORT_FILE: options.exportFile,
        EXPORT_BUCKET: output('db_exports_bucket'),
      }),
      // A new value every run makes the job update a real change, so Cloud
      // Run resolves db-init:latest again (the image infra:deploy just pushed)
      RUN_STARTED_AT: new Date().toISOString(),
    },
    serviceAccount: output('db_jobs_service_account_email'),
    credentials,
    cpu: '1',
    memory: '512Mi',
    // Saving or restoring a large database takes longer than setting up roles
    ...(options.exportFile && {
      timeoutSeconds: DB_EXPORT_JOB_TIMEOUT_SECONDS,
    }),
  });

  if (!result.success) {
    throw new CliError(
      `db-init (${options.mode}) failed`,
      'Database users',
      result.logs,
    );
  }
  logger.success(`db-init (${options.mode}) completed`);
}
