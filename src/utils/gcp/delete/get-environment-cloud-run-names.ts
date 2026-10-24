/**
 * Get Environment Cloud Run Names
 *
 * Names of the Cloud Run services and jobs that deploys create with the SDK
 * in an environment, outside Terraform: the NestJS and Next.js services,
 * the workers, Kong (`{project}-kong`) and the database migration jobs
 * (`migrate-{service}`). SPAs are storage buckets (Terraform), not Cloud Run.
 */

import type { FrameworkService } from '@tsdevstack/cli/plugin';
import {
  DEPLOYABLE_SERVICE_TYPES,
  GCP_KONG_SERVICE_SUFFIX,
  GCP_MIGRATION_JOB_PREFIX,
} from '../../../constants';

export interface EnvironmentCloudRunNames {
  services: string[];
  jobs: string[];
}

/**
 * List the Cloud Run services and jobs of an environment
 *
 * @param services - Services from .tsdevstack/config.json
 * @param projectName - Project name (Kong's service is `{project}-kong`)
 * @returns Service and job names
 */
export function getEnvironmentCloudRunNames(
  services: FrameworkService[],
  projectName: string,
): EnvironmentCloudRunNames {
  const cloudRunServices = services
    .filter(
      (s) =>
        (DEPLOYABLE_SERVICE_TYPES as readonly string[]).includes(s.type) ||
        s.type === 'worker',
    )
    .map((s) => s.name);

  return {
    services: [...cloudRunServices, `${projectName}${GCP_KONG_SERVICE_SUFFIX}`],
    jobs: services
      .filter((s) => s.hasDatabase)
      .map((s) => `${GCP_MIGRATION_JOB_PREFIX}${s.name}`),
  };
}
