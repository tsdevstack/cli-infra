/**
 * Validate Version Field
 *
 * Validates the version field in infrastructure.json.
 */

import { getContext } from '../../context';
import { SUPPORTED_VERSIONS } from '../../constants';
import type { InfrastructureConfig } from './types';

/**
 * Validate version field exists and is supported
 *
 * @param config - Infrastructure configuration
 * @throws CliError if version is missing, invalid, or unsupported
 */
export function validateVersion(config: InfrastructureConfig): void {
  const { CliError } = getContext();

  // Version must exist
  if (!('version' in config)) {
    throw new CliError(
      'Missing "version" field in infrastructure.json',
      'Infrastructure Config',
      'Add "version": "1.0.0" to your configuration'
    );
  }

  const { version } = config;

  // Version must be a string
  if (typeof version !== 'string') {
    throw new CliError(
      'Invalid "version" field: must be a string',
      'Infrastructure Config',
      'Use semver format: "1.0.0"'
    );
  }

  // Version must match semver pattern
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new CliError(
      `Invalid version format: "${version}"`,
      'Infrastructure Config',
      'Use semver format: "X.Y.Z" (e.g., "1.0.0")'
    );
  }

  // Version must be supported (exact match)
  if (!SUPPORTED_VERSIONS.includes(version as (typeof SUPPORTED_VERSIONS)[number])) {
    throw new CliError(
      `Unsupported version: "${version}"`,
      'Infrastructure Config',
      `Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`
    );
  }
}