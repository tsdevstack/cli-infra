/**
 * Merge Service Override with Defaults
 *
 * Merges partial service override with built-in defaults.
 */

import { getContext } from '../../context';
import {
  INFRASTRUCTURE_DEFAULTS_GCP,
  INFRASTRUCTURE_DEFAULTS_AWS,
  INFRASTRUCTURE_DEFAULTS_AZURE,
} from '../../constants';
import type {
  ServiceOverride,
  ResolvedServiceConfig,
  InfraProvider,
} from './types';

/**
 * Merge service override with defaults
 *
 * @param override - Partial override from infrastructure.json (or undefined)
 * @param serviceName - Service name for error messages
 * @param environment - Environment name for error messages
 * @param provider - Cloud provider ('gcp', 'aws', or 'azure')
 * @returns Fully resolved configuration
 * @throws CliError if minInstances > maxInstances after merge
 */
export function mergeServiceWithDefaults(
  override: ServiceOverride | undefined,
  serviceName: string,
  environment: string,
  provider: InfraProvider,
): ResolvedServiceConfig {
  const defaults =
    provider === 'aws'
      ? INFRASTRUCTURE_DEFAULTS_AWS
      : provider === 'azure'
        ? INFRASTRUCTURE_DEFAULTS_AZURE
        : INFRASTRUCTURE_DEFAULTS_GCP;

  const resolved: ResolvedServiceConfig = {
    minInstances: override?.minInstances ?? defaults.minInstances,
    maxInstances: override?.maxInstances ?? defaults.maxInstances,
    cpu: override?.cpu ?? defaults.cpu,
    memory: override?.memory ?? defaults.memory,
    timeout: override?.timeout ?? defaults.timeout,
    port: override?.port ?? defaults.port,
    concurrency: override?.concurrency ?? defaults.concurrency,
  };

  // Validate minInstances <= maxInstances after merge
  if (resolved.minInstances > resolved.maxInstances) {
    const { CliError } = getContext();
    throw new CliError(
      `${environment}.${serviceName}: minInstances (${resolved.minInstances}) > maxInstances (${resolved.maxInstances})`,
      'Infrastructure Config',
      `Set maxInstances >= ${resolved.minInstances} or reduce minInstances`,
    );
  }

  return resolved;
}
