/**
 * Merge Database Override with Defaults
 *
 * Merges partial database override with built-in defaults.
 */

import {
  DATABASE_DEFAULTS_GCP,
  DATABASE_DEFAULTS_AWS,
  DATABASE_DEFAULTS_AZURE,
} from '../../constants';
import type {
  DatabaseOverride,
  ResolvedDatabaseConfig,
  InfraProvider,
} from './types';

/**
 * Merge database override with defaults
 *
 * @param override - Partial database override from infrastructure.json (or undefined)
 * @param provider - Cloud provider ('gcp', 'aws', or 'azure')
 * @returns Fully resolved database configuration
 */
export function mergeDatabaseWithDefaults(
  override: DatabaseOverride | undefined,
  provider: InfraProvider,
): ResolvedDatabaseConfig {
  const defaults =
    provider === 'aws'
      ? DATABASE_DEFAULTS_AWS
      : provider === 'azure'
        ? DATABASE_DEFAULTS_AZURE
        : DATABASE_DEFAULTS_GCP;

  return {
    tier: override?.tier ?? defaults.tier,
    diskSize: override?.diskSize ?? defaults.diskSize,
    deletionProtection:
      override?.deletionProtection ?? defaults.deletionProtection,
    ha: override?.ha ?? defaults.ha,
    backup: override?.backup ?? defaults.backup,
  };
}
