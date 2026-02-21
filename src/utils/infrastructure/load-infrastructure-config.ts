/**
 * Load Infrastructure Configuration
 *
 * Loads and parses infrastructure.json file.
 * Returns null if file doesn't exist (uses defaults).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getContext } from '../../context';
import { INFRASTRUCTURE_CONFIG_FILENAME } from '../../constants';
import type { InfrastructureConfig } from './types';

/**
 * Load infrastructure.json configuration
 *
 * @returns InfrastructureConfig if file exists, null if missing
 * @throws CliError if file exists but is invalid JSON or empty
 */
export function loadInfrastructureConfig(): InfrastructureConfig | null {
  const { findProjectRoot, TSDEVSTACK_DIR, CliError } = getContext();
  const projectRoot = findProjectRoot();
  const configDir = TSDEVSTACK_DIR;
  const configPath = join(projectRoot, configDir, INFRASTRUCTURE_CONFIG_FILENAME);

  // File missing is OK - use built-in defaults
  if (!existsSync(configPath)) {
    return null;
  }

  // Read file content
  let content: string;
  try {
    content = readFileSync(configPath, 'utf-8');
  } catch {
    throw new CliError(
      `Failed to read ${INFRASTRUCTURE_CONFIG_FILENAME}`,
      'Infrastructure Config',
      `Check file permissions: ${configPath}`
    );
  }

  // Empty file is an error
  if (!content.trim()) {
    throw new CliError(
      `${INFRASTRUCTURE_CONFIG_FILENAME} is empty`,
      'Infrastructure Config',
      'Either delete the file to use defaults, or add valid configuration'
    );
  }

  // Parse JSON
  let config: unknown;
  try {
    config = JSON.parse(content);
  } catch {
    throw new CliError(
      `Invalid JSON in ${INFRASTRUCTURE_CONFIG_FILENAME}`,
      'Infrastructure Config',
      'Check for syntax errors in your configuration file'
    );
  }

  return config as InfrastructureConfig;
}