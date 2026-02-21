/**
 * Get current git SHA
 */

import { execSync } from 'node:child_process';

/**
 * Get current git commit SHA (short form)
 */
export function getGitSha(): string {
  const sha = execSync('git rev-parse --short HEAD', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return sha.trim();
}