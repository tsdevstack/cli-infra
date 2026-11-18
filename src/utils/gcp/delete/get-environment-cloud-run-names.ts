/**
 * Get Environment Cloud Run Names
 *
 * Names of the Cloud Run services and jobs that deploys create with the SDK
 * in an environment, outside Terraform: the NestJS and Next.js services,
 * the workers, Kong (`{project}-kong`), the database migration jobs, named
 * the way the environment names them (buildGcpCloudRunName), and db-init
 * (`{project}-db-init`, every naming scheme). db-init runs in the subnet:
 * left behind, it keeps one of its addresses. SPAs are storage buckets
 * (Terraform), not Cloud Run.
 */

import type { FrameworkService } from '@tsdevstack/cli/plugin';
import {
  buildGcpCloudRunName,
  type NamingScheme,
} from '@tsdevstack/infra-core';
import {
  DEPLOYABLE_SERVICE_TYPES,
  GCP_DB_INIT_JOB_SUFFIX,
  GCP_KONG_SERVICE_SUFFIX,
} from '../../../constants';
import { buildGcpMigrationJobName } from '../build-gcp-migration-job-name';

export interface EnvironmentCloudRunNames {
  services: string[];
  jobs: string[];
}

/**
 * List the Cloud Run services and jobs of an environment
 *
 * @param services - Services from .tsdevstack/config.json
 * @param projectName - Project name (Kong's service is `{project}-kong`)
 * @param naming - The environment's naming scheme
 * @returns Service and job names
 */
export function getEnvironmentCloudRunNames(
  services: FrameworkService[],
  projectName: string,
  naming: NamingScheme,
): EnvironmentCloudRunNames {
  const cloudRunServices = services
    .filter(
      (s) =>
        (DEPLOYABLE_SERVICE_TYPES as readonly string[]).includes(s.type) ||
        s.type === 'worker',
    )
    .map((s) => buildGcpCloudRunName(projectName, s.name, naming));

  return {
    services: [...cloudRunServices, `${projectName}${GCP_KONG_SERVICE_SUFFIX}`],
    jobs: [
      ...services
        .filter((s) => s.hasDatabase)
        .map((s) => buildGcpMigrationJobName(projectName, s.name, naming)),
      `${projectName}${GCP_DB_INIT_JOB_SUFFIX}`,
    ],
  };
}
