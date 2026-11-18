/**
 * Build the Cloud Run job name of a service's database migration
 */

import {
  buildGcpCloudRunName,
  type NamingScheme,
} from '@tsdevstack/infra-core';
import { GCP_MIGRATION_JOB_PREFIX } from '../../constants';

/**
 * `migrate-{service}` in a legacy environment,
 * `{project}-migrate-{service}` in the unique scheme.
 *
 * @param projectName - Project name from config.json
 * @param serviceName - The service whose database the job migrates
 * @param naming - The environment's naming scheme
 * @returns The Cloud Run job name
 */
export function buildGcpMigrationJobName(
  projectName: string,
  serviceName: string,
  naming: NamingScheme,
): string {
  return buildGcpCloudRunName(
    projectName,
    `${GCP_MIGRATION_JOB_PREFIX}${serviceName}`,
    naming,
  );
}
