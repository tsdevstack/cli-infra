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
} from './types';
import { RESERVED_ENVIRONMENT_KEYS } from './types';
import type { SchemaProvider } from './get-provider-schema-config';
import { validateVersion } from './validate-version';
import { validateServiceOverride } from './validate-service-override';

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

      // Check if it's a reserved key (like "database", "redis")
      if (
        RESERVED_ENVIRONMENT_KEYS.includes(
          itemKey as (typeof RESERVED_ENVIRONMENT_KEYS)[number],
        )
      ) {
        // database and redis validation can be added here when needed
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
    }
  }
}
