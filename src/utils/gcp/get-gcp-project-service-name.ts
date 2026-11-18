/**
 * Tell whether a Cloud Run service is this project's, and its name
 */

import { GCP_PROJECT_LABEL, type NamingScheme } from '@tsdevstack/infra-core';
import { parseGcpCloudRunName } from './parse-gcp-cloud-run-name';

/**
 * The service's name in config.json when it is this project's, else
 * undefined. In the unique scheme it must carry the project's label
 * (buildGcpServiceLabels) as well as the `{project}-` prefix: the prefix
 * alone also matches a project whose name starts the same way (`shop` reads
 * `shop-admin-auth-service` as `admin-auth-service`). A legacy environment's
 * names are the service names.
 *
 * @param projectName - Project name from config.json
 * @param service - A listed Cloud Run service: its name and labels
 * @param naming - The environment's naming scheme
 * @returns The service name, or undefined when it isn't this project's
 */
export function getGcpProjectServiceName(
  projectName: string,
  service: { name: string; labels?: Record<string, string> },
  naming: NamingScheme,
): string | undefined {
  if (
    naming === 'unique' &&
    service.labels?.[GCP_PROJECT_LABEL] !== projectName
  ) {
    return undefined;
  }
  return parseGcpCloudRunName(projectName, service.name, naming);
}
