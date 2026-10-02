/**
 * Validate Infrastructure Configuration
 *
 * Main entry point for validating infrastructure.json against schema v1.0.0.
 * All validation errors are fatal - no warnings.
 */

import { getContext } from '../../context';
import type {
  InfrastructureConfig,
  ServiceOverride,
  EnvironmentOverrides,
  KongOverride,
  DatabaseOverride,
} from './types';
import { RESERVED_ENVIRONMENT_KEYS } from './types';
import type { SchemaProvider } from './get-provider-schema-config';
import { validateVersion } from './validate-version';
import { validateServiceOverride } from './validate-service-override';
import { validateAccessControl } from './validate-access-control';
import { validateDatabaseServerName } from './validate-database-server-name';
import { validateAwsMinInstances } from '../aws/infrastructure/validate-aws-min-instances';

/**
 * Validate infrastructure.json configuration
 *
 * @throws CliError on any validation failure
 */
export function validateInfrastructureConfig(
  config: InfrastructureConfig,
): void {
  const { CliError, loadFrameworkConfig } = getContext();

  // 1. Validate version exists and is supported
  validateVersion(config);

  // 2. Get valid service names and provider from framework config
  const frameworkConfig = loadFrameworkConfig();
  const validServiceNames = new Set(
    frameworkConfig.services.map((s) => s.name),
  );
  const serviceTypes = new Map(
    frameworkConfig.services.map((s) => [s.name, s.type]),
  );
  const provider: SchemaProvider = frameworkConfig.cloud.provider ?? 'gcp';

  // 3. Validate each environment
  for (const [key, value] of Object.entries(config)) {
    if (key === 'version' || key === '$schema') continue;

    // Environment value must be an object
    if (typeof value !== 'object' || value === null) {
      throw new CliError(
        `Invalid environment "${key}": must be an object`,
        'Infrastructure Config',
        'Environment should contain service overrides: { "service-name": { ... } }',
      );
    }

    const envOverrides = value as EnvironmentOverrides;

    // Validate each key in environment
    for (const [itemKey, override] of Object.entries(envOverrides)) {
      if (override === undefined) continue;

      // Check if it's a reserved key (like "database", "redis", "kong")
      if (
        RESERVED_ENVIRONMENT_KEYS.includes(
          itemKey as (typeof RESERVED_ENVIRONMENT_KEYS)[number],
        )
      ) {
        if (itemKey === 'accessControl') {
          validateAccessControl(key, override);
        }
        // AWS has no scale-to-zero: Kong must run at least one task
        if (itemKey === 'kong' && provider === 'aws') {
          const kongMin = (override as KongOverride).minInstances;
          if (typeof kongMin === 'number') {
            validateAwsMinInstances(kongMin, `${key}.kong`);
          }
        }
        // database.serverName is Azure only and must follow Azure naming rules
        if (
          itemKey === 'database' &&
          typeof override === 'object' &&
          override !== null
        ) {
          validateDatabaseServerName(
            key,
            (override as DatabaseOverride).serverName,
            provider,
          );
        }
        // redis validation can be added here when needed
        continue;
      }

      // Otherwise it's a service name - must exist in config.json
      if (!validServiceNames.has(itemKey)) {
        throw new CliError(
          `Unknown service "${itemKey}" in environment "${key}"`,
          'Infrastructure Config',
          `Valid services: ${Array.from(validServiceNames).join(', ')}`,
        );
      }

      // Validate the service override (provider-aware for CPU/memory)
      validateServiceOverride(
        itemKey,
        key,
        override as ServiceOverride,
        provider,
      );

      // AWS has no scale-to-zero: every ECS service runs at least one task
      // (SPAs are served from S3 and have no instances)
      const serviceMin = (override as ServiceOverride).minInstances;
      if (
        provider === 'aws' &&
        serviceTypes.get(itemKey) !== 'spa' &&
        typeof serviceMin === 'number'
      ) {
        validateAwsMinInstances(serviceMin, `${key}.${itemKey}`);
      }
    }
  }
}
