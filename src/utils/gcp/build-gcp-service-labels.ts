/**
 * Build the labels of a Cloud Run service
 */

import { GCP_PROJECT_LABEL, type NamingScheme } from '@tsdevstack/infra-core';

/**
 * In the unique scheme every Cloud Run service carries the project
 * (`tsdevstack-project: {project}`), so discovery can tell this project's
 * services from those of a project whose name starts the same way. Legacy
 * environments get no labels: their services stay as they are.
 *
 * @param projectName - Project name from config.json
 * @param naming - The environment's naming scheme
 * @returns The labels, or undefined for a legacy environment
 */
export function buildGcpServiceLabels(
  projectName: string,
  naming: NamingScheme,
): Record<string, string> | undefined {
  return naming === 'unique' ? { [GCP_PROJECT_LABEL]: projectName } : undefined;
}
