/**
 * Get workspace package paths for Dockerfile COPY statements
 */

import path from 'node:path';
import fs from 'node:fs';

/**
 * Scan packages/ directory and return paths for package.json COPY statements
 *
 * Returns paths like: ["packages/nest-common", "packages/auth-service-client"]
 * These are used in Dockerfile to copy package.json files before npm ci
 */
export function getWorkspacePackages(projectRoot: string): string[] {
  const packagesDir = path.join(projectRoot, 'packages');

  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const packages: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    // Check if this is a package (has package.json)
    const packageJsonPath = path.join(packagesDir, entry.name, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      packages.push(`packages/${entry.name}`);
    }
  }

  return packages.sort();
}