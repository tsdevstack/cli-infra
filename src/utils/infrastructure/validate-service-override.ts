/**
 * Validate Service Override
 *
 * Validates service configuration in infrastructure.json.
 * Validation is provider-aware: CPU/memory values differ per cloud provider.
 */

import { getContext } from '../../context';
import {
  VALID_CPU_VALUES_GCP,
  VALID_CPU_VALUES_AWS,
  VALID_CPU_VALUES_AZURE,
  VALID_MEMORY_VALUES_GCP,
  VALID_MEMORY_VALUES_AWS,
  VALID_MEMORY_VALUES_AZURE,
  VALIDATION_CONSTRAINTS,
} from '../../constants';
import { VALID_OVERRIDE_FIELDS } from './types';
import type { ServiceOverride } from './types';
import type { SchemaProvider } from './get-provider-schema-config';
import { validateInteger } from './validate-integer';
import { validateEnum } from './validate-enum';
import { validateTimeout } from './validate-timeout';
import { validateAzureCpuMemoryPair } from '../azure/infrastructure/validate-azure-cpu-memory-pair';

/**
 * Get provider-specific CPU values
 */
function getCpuValues(provider: SchemaProvider): readonly string[] {
  if (provider === 'aws') return VALID_CPU_VALUES_AWS;
  if (provider === 'azure') return VALID_CPU_VALUES_AZURE;
  return VALID_CPU_VALUES_GCP;
}

/**
 * Get provider-specific memory values
 */
function getMemoryValues(provider: SchemaProvider): readonly string[] {
  if (provider === 'aws') return VALID_MEMORY_VALUES_AWS;
  if (provider === 'azure') return VALID_MEMORY_VALUES_AZURE;
  return VALID_MEMORY_VALUES_GCP;
}

/**
 * Validate a service override configuration
 *
 * @param serviceName - Service name for error messages
 * @param environment - Environment name for error messages
 * @param override - Service override to validate
 * @param provider - Cloud provider (determines valid CPU/memory values)
 * @throws CliError if validation fails
 */
export function validateServiceOverride(
  serviceName: string,
  environment: string,
  override: ServiceOverride,
  provider: SchemaProvider,
): void {
  const { CliError } = getContext();
  const context = `${environment}.${serviceName}`;

  // Override must be an object (not array or null)
  if (
    typeof override !== 'object' ||
    override === null ||
    Array.isArray(override)
  ) {
    throw new CliError(
      `Invalid override for ${context}: must be an object`,
      'Infrastructure Config',
      'Service override should be: { "minInstances": 0, ... }',
    );
  }

  // Check for unknown fields
  for (const field of Object.keys(override)) {
    if (
      !VALID_OVERRIDE_FIELDS.includes(
        field as (typeof VALID_OVERRIDE_FIELDS)[number],
      )
    ) {
      throw new CliError(
        `Unknown field "${field}" in ${context}`,
        'Infrastructure Config',
        `Valid fields: ${VALID_OVERRIDE_FIELDS.join(', ')}`,
      );
    }
  }

  // Validate individual fields
  if (override.minInstances !== undefined) {
    validateInteger(
      override.minInstances,
      'minInstances',
      context,
      VALIDATION_CONSTRAINTS.minInstances.min,
      VALIDATION_CONSTRAINTS.minInstances.max,
    );
  }

  if (override.maxInstances !== undefined) {
    validateInteger(
      override.maxInstances,
      'maxInstances',
      context,
      VALIDATION_CONSTRAINTS.maxInstances.min,
      VALIDATION_CONSTRAINTS.maxInstances.max,
    );
  }

  if (override.cpu !== undefined) {
    validateEnum(override.cpu, 'cpu', context, getCpuValues(provider));
  }

  if (override.memory !== undefined) {
    validateEnum(override.memory, 'memory', context, getMemoryValues(provider));
  }

  // Azure Container Apps requires valid CPU/memory pairs
  if (
    provider === 'azure' &&
    override.cpu !== undefined &&
    override.memory !== undefined &&
    typeof override.cpu === 'string' &&
    typeof override.memory === 'string'
  ) {
    validateAzureCpuMemoryPair(override.cpu, override.memory, context);
  }

  if (override.timeout !== undefined) {
    validateTimeout(override.timeout, context);
  }

  if (override.port !== undefined) {
    validateInteger(
      override.port,
      'port',
      context,
      VALIDATION_CONSTRAINTS.port.min,
      VALIDATION_CONSTRAINTS.port.max,
    );
  }

  if (override.concurrency !== undefined) {
    validateInteger(
      override.concurrency,
      'concurrency',
      context,
      VALIDATION_CONSTRAINTS.concurrency.min,
      VALIDATION_CONSTRAINTS.concurrency.max,
    );
  }
}
