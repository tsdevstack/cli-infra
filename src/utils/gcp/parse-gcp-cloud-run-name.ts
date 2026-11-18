/**
 * Read the service name back from a Cloud Run name
 */

import type { NamingScheme } from '@tsdevstack/infra-core';

/**
 * The reverse of buildGcpCloudRunName: the service (or worker) name a Cloud
 * Run service of this project carries. In the unique scheme a name without
 * the `{project}-` prefix belongs to another project in the same GCP
 * project: undefined. A legacy environment's names are the service names.
 *
 * @param projectName - Project name from config.json
 * @param cloudRunName - Name of a Cloud Run service or job
 * @param naming - The environment's naming scheme
 * @returns The service name, or undefined when it isn't this project's
 */
export function parseGcpCloudRunName(
  projectName: string,
  cloudRunName: string,
  naming: NamingScheme,
): string | undefined {
  if (naming === 'legacy') {
    return cloudRunName;
  }
  const prefix = `${projectName}-`;
  return cloudRunName.startsWith(prefix) && cloudRunName.length > prefix.length
    ? cloudRunName.slice(prefix.length)
    : undefined;
}
