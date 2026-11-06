/**
 * Get workspace package dependencies for a specific service
 *
 * Analyzes the service's package.json to determine which workspace
 * packages it actually needs, avoiding unnecessary packages in Docker builds.
 */

import path from 'node:path';
import fs from 'node:fs';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface WorkspacePackage {
  path: string;
  deps: string[];
}

/**
 * Get workspace packages that a service actually depends on
 *
 * Returns paths like: ["packages/telemetry", "packages/nest-common"]
 * Includes the workspace packages those packages need (nest-common needs
 * telemetry), each listed after the packages it needs, so the Dockerfile
 * installs and builds them in that order.
 */
export function getServiceWorkspaceDeps(
  projectRoot: string,
  serviceName: string,
): string[] {
  const packagesDir = path.join(projectRoot, 'packages');
  const servicePackageJsonPath = path.join(
    projectRoot,
    'apps',
    serviceName,
    'package.json',
  );

  if (!fs.existsSync(servicePackageJsonPath)) {
    return [];
  }

  // Read service package.json
  const servicePackageJson: PackageJson = JSON.parse(
    fs.readFileSync(servicePackageJsonPath, 'utf-8'),
  );

  // Dependencies needed to build: regular and dev
  const buildDeps = (pkg: PackageJson): string[] =>
    Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();

  // Workspace package names with their paths and dependencies
  const workspacePackages = new Map<string, WorkspacePackage>();

  if (fs.existsSync(packagesDir)) {
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(
        packagesDir,
        entry.name,
        'package.json',
      );
      if (fs.existsSync(packageJsonPath)) {
        const pkgJson: PackageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf-8'),
        );
        if (pkgJson.name) {
          workspacePackages.set(pkgJson.name, {
            path: `packages/${entry.name}`,
            deps: buildDeps(pkgJson),
          });
        }
      }
    }
  }

  // Each package after the workspace packages it needs
  const neededPackages: string[] = [];
  const visited = new Set<string>();

  const visit = (name: string): void => {
    const pkg = workspacePackages.get(name);
    if (!pkg || visited.has(name)) {
      return;
    }
    visited.add(name);
    pkg.deps.forEach(visit);
    neededPackages.push(pkg.path);
  };

  buildDeps(servicePackageJson).forEach(visit);

  return neededPackages;
}
