/**
 * Merge Kong Override with Defaults
 *
 * Merges partial Kong override with built-in defaults.
 */

import {
  KONG_DEFAULTS_GCP,
  KONG_DEFAULTS_AWS,
  KONG_DEFAULTS_AZURE,
} from '../../constants';
import type { KongOverride, ResolvedKongConfig, InfraProvider } from './types';

/**
 * Merge Kong override with defaults
 *
 * @param override - Partial Kong override from infrastructure.json (or undefined)
 * @param provider - Cloud provider ('gcp', 'aws', or 'azure')
 * @returns Fully resolved Kong configuration
 */
export function mergeKongWithDefaults(
  override: KongOverride | undefined,
  provider: InfraProvider,
): ResolvedKongConfig {
  const defaults =
    provider === 'aws'
      ? KONG_DEFAULTS_AWS
      : provider === 'azure'
        ? KONG_DEFAULTS_AZURE
        : KONG_DEFAULTS_GCP;

  return {
    minInstances: override?.minInstances ?? defaults.minInstances,
    maxInstances: override?.maxInstances ?? defaults.maxInstances,
    cpu: override?.cpu ?? defaults.cpu,
    memory: override?.memory ?? defaults.memory,
  };
}
