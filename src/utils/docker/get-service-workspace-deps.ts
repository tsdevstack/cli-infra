/**
 * Get workspace package dependencies for a specific service
 *
 * Analyzes the service's package.json to determine which workspace
 * packages it actually needs, avoiding unnecessary packages in Docker builds.
 */

import path from 'node:path';
import fs from 'node:fs';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Get workspace packages that a service actually depends on
 *
 * Returns paths like: ["packages/nest-common"]
 * Only includes packages that are actual dependencies of the service.
 */
export function getServiceWorkspaceDeps(projectRoot: string, serviceName: string): string[] {
  const packagesDir = path.join(projectRoot, 'packages');
  const servicePackageJsonPath = path.join(projectRoot, 'apps', serviceName, 'package.json');

  if (!fs.existsSync(servicePackageJsonPath)) {
    return [];
  }

  // Read service package.json
  const servicePackageJson: PackageJson = JSON.parse(
    fs.readFileSync(servicePackageJsonPath, 'utf-8')
  );

  // Collect all dependencies (both regular and dev for build)
  const allDeps = {
    ...servicePackageJson.dependencies,
    ...servicePackageJson.devDependencies,
  };

  // Build a map of workspace package names to their paths
  const workspacePackageMap = new Map<string, string>();

  if (fs.existsSync(packagesDir)) {
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(packagesDir, entry.name, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkgJson: PackageJson & { name?: string } = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf-8')
        );
        if (pkgJson.name) {
          workspacePackageMap.set(pkgJson.name, `packages/${entry.name}`);
        }
      }
    }
  }

  // Find which workspace packages the service depends on
  const neededPackages: string[] = [];

  for (const depName of Object.keys(allDeps)) {
    const packagePath = workspacePackageMap.get(depName);
    if (packagePath) {
      neededPackages.push(packagePath);
    }
  }

  return neededPackages.sort();
}