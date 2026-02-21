/**
 * Check if Docker CLI is installed
 */

import { execSync } from 'node:child_process';
import { getContext } from '../../context';

export function checkDockerInstalled(): boolean {
  const { CliError } = getContext();

  try {
    execSync('docker version', { stdio: 'pipe' });
    return true;
  } catch {
    throw new CliError(
      'Docker CLI not found',
      'infra:docker',
      'Install Docker: https://docs.docker.com/get-docker/'
    );
  }
}