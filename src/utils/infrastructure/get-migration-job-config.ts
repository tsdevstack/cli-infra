/**
 * Get Migration Job Configuration
 *
 * Extracts migration job CPU/memory from infrastructure.json database config.
 * Returns resolved values with provider-specific defaults applied.
 */

import {
  MIGRATION_JOB_DEFAULTS_GCP,
  MIGRATION_JOB_DEFAULTS_AWS,
  MIGRATION_JOB_DEFAULTS_AZURE,
} from '../../constants';
import type { MigrationJobConfig, InfraProvider } from './types';

export interface ResolvedMigrationJobConfig {
  cpu: string;
  memory: string;
}

/**
 * Get resolved migration job configuration for an environment
 *
 * @param config - Infrastructure config (or null for all defaults)
 * @param environment - Environment name
 * @param provider - Cloud provider ('gcp', 'aws', or 'azure')
 * @returns Resolved migration job config with provider-specific defaults applied
 */
export function getMigrationJobConfig(
  config: { [env: string]: unknown } | null,
  environment: string,
  provider: InfraProvider,
): ResolvedMigrationJobConfig {
  const defaults =
    provider === 'aws'
      ? MIGRATION_JOB_DEFAULTS_AWS
      : provider === 'azure'
        ? MIGRATION_JOB_DEFAULTS_AZURE
        : MIGRATION_JOB_DEFAULTS_GCP;

  if (!config) {
    return { ...defaults };
  }

  const envConfig = config[environment];
  if (!envConfig || typeof envConfig !== 'object') {
    return { ...defaults };
  }

  const database = (
    envConfig as { database?: { migrationJob?: MigrationJobConfig } }
  ).database;
  const migrationJob = database?.migrationJob;

  return {
    cpu: migrationJob?.cpu ?? defaults.cpu,
    memory: migrationJob?.memory ?? defaults.memory,
  };
}
