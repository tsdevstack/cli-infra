/**
 * Get Database Configuration
 *
 * Looks up database in infrastructure config and merges with defaults.
 */

import type {
  DatabaseOverride,
  ResolvedDatabaseConfig,
  InfraProvider,
} from './types';
import { mergeDatabaseWithDefaults } from './merge-database-with-defaults';

/**
 * Get resolved database configuration for an environment
 *
 * @param config - Infrastructure config (or null for all defaults)
 * @param environment - Environment name
 * @param provider - Cloud provider ('gcp' or 'aws')
 * @returns Fully resolved database configuration
 */
export function getDatabaseConfig(
  config: { [env: string]: unknown } | null,
  environment: string,
  provider: InfraProvider,
): ResolvedDatabaseConfig {
  // No config file - use all defaults
  if (!config) {
    return mergeDatabaseWithDefaults(undefined, provider);
  }

  // Get environment overrides
  const envConfig = config[environment];
  if (!envConfig || typeof envConfig !== 'object') {
    return mergeDatabaseWithDefaults(undefined, provider);
  }

  // Get database override
  const databaseOverride = (envConfig as { database?: DatabaseOverride })
    .database;

  return mergeDatabaseWithDefaults(databaseOverride, provider);
}
