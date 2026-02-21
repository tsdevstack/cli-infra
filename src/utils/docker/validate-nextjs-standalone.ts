/**
 * Validate Next.js standalone output configuration
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../../context';

/**
 * Validate that a Next.js app has output: "standalone" configured
 *
 * This is required for containerized deployments. Without standalone output,
 * the Docker build will fail as it won't find the standalone server files.
 *
 * @throws CliError if standalone output is not configured
 */
export function validateNextjsStandalone(projectRoot: string, serviceName: string): void {
  const { CliError } = getContext();

  const configPath = path.join(projectRoot, 'apps', serviceName, 'next.config.ts');
  const configPathJs = path.join(projectRoot, 'apps', serviceName, 'next.config.js');
  const configPathMjs = path.join(projectRoot, 'apps', serviceName, 'next.config.mjs');

  // Find the config file
  let foundPath: string | null = null;
  for (const p of [configPath, configPathJs, configPathMjs]) {
    if (fs.existsSync(p)) {
      foundPath = p;
      break;
    }
  }

  if (!foundPath) {
    throw new CliError(
      `Next.js config not found for ${serviceName}`,
      'infra:generate-docker',
      `Create apps/${serviceName}/next.config.ts with output: "standalone"`
    );
  }

  // Read and check for standalone output
  const content = fs.readFileSync(foundPath, 'utf-8');

  // Simple check for output: "standalone" or output: 'standalone'
  // This regex handles various formats:
  // - output: "standalone"
  // - output: 'standalone'
  // - output:"standalone"
  // - "output": "standalone"
  const standalonePattern = /["']?output["']?\s*:\s*["']standalone["']/;

  if (!standalonePattern.test(content)) {
    throw new CliError(
      `Next.js "${serviceName}" is not configured for standalone output`,
      'infra:generate-docker',
      `Add output: "standalone" to apps/${serviceName}/next.config.ts\n\n` +
        `Example:\n` +
        `  const nextConfig: NextConfig = {\n` +
        `    output: "standalone",\n` +
        `  };`
    );
  }
}