/**
 * Get AWS Database Configuration
 *
 * Extracts and merges AWS-specific database config from infrastructure.json
 */

import type { AWSInfraConfig } from '@tsdevstack/infra-core';

/**
 * Get AWS-specific database configuration from infrastructure config
 */
export function getAWSDatabaseConfig(
  infraConfig: { [env: string]: unknown } | null,
  environment: string,
): AWSInfraConfig['database'] {
  const defaults = {
    tier: 'db.t3.micro',
    storageSizeGb: 20,
    deletionProtection: true,
    backup: true,
  };

  if (!infraConfig) return defaults;

  const envConfig = infraConfig[environment];
  if (!envConfig || typeof envConfig !== 'object') return defaults;

  const dbOverride = (envConfig as { database?: Record<string, unknown> })
    .database;
  if (!dbOverride) return defaults;

  return {
    tier: (dbOverride.tier as string) ?? defaults.tier,
    storageSizeGb:
      (dbOverride.storageSizeGb as number) ?? defaults.storageSizeGb,
    deletionProtection:
      (dbOverride.deletionProtection as boolean) ?? defaults.deletionProtection,
    backup: (dbOverride.backup as boolean) ?? defaults.backup,
  };
}
