/**
 * Validate the names a GCP environment gives its Cloud Run services, jobs
 * and storage buckets
 */

import type { FrameworkService } from '@tsdevstack/cli/plugin';
import {
  GCP_CLOUD_RUN_NAME_MAX_LENGTH,
  GCS_BUCKET_NAME_MAX_LENGTH,
  buildGcsStorageBucketName,
  type NamingScheme,
} from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { getEnvironmentCloudRunNames } from '../delete/get-environment-cloud-run-names';
import { buildGcpCronJobName } from '../build-gcp-cron-job-name';

/**
 * Stop before anything deploys when a name is too long: Cloud Run takes
 * names under 50 characters, GCS bucket names at most 63. The unique scheme
 * adds the project to Cloud Run names and a suffix to bucket names, so a
 * project and service that fit before may not. A legacy environment keeps
 * the names it already has, so they are not checked again; a cron job's
 * Cloud Run Job is new in both schemes, so it is always checked.
 *
 * @throws CliError naming the first name too long, its length and the limit
 */
export function validateGcpResourceNames(options: {
  projectName: string;
  environment: string;
  gcpProjectId: string;
  naming: NamingScheme;
  services: FrameworkService[];
  storageBuckets: string[];
  /** The environment's cron jobs (infrastructure.json) */
  cronJobNames?: string[];
  commandName: string;
}): void {
  const { CliError } = getContext();
  const { projectName, naming, commandName } = options;

  for (const jobName of options.cronJobNames ?? []) {
    const name = buildGcpCronJobName(projectName, jobName, naming);
    if (name.length > GCP_CLOUD_RUN_NAME_MAX_LENGTH) {
      throw new CliError(
        `Cloud Run Job name "${name}" is ${name.length} characters; Cloud Run takes at most ${GCP_CLOUD_RUN_NAME_MAX_LENGTH}`,
        commandName,
        `A cron job's Cloud Run Job is ${naming === 'unique' ? '{project}-cron-{name}' : 'cron-{name}'}. Shorten the cron job's name (register-cron with the new name, move the handler's code over, remove the old handler file and its entry)${naming === 'unique' ? ' or the project name' : ''}.`,
      );
    }
  }

  if (naming === 'legacy') {
    return;
  }

  const { services, jobs } = getEnvironmentCloudRunNames(
    options.services,
    projectName,
    naming,
  );
  for (const name of [...services, ...jobs]) {
    if (name.length > GCP_CLOUD_RUN_NAME_MAX_LENGTH) {
      throw new CliError(
        `Cloud Run name "${name}" is ${name.length} characters; Cloud Run takes at most ${GCP_CLOUD_RUN_NAME_MAX_LENGTH}`,
        commandName,
        `Cloud Run names are {project}-{service} (migration jobs {project}-migrate-{service}). Shorten the project name in .tsdevstack/config.json or the service name.`,
      );
    }
  }

  for (const bucket of options.storageBuckets) {
    const name = buildGcsStorageBucketName({
      projectName,
      bucket,
      environment: options.environment,
      gcpProjectId: options.gcpProjectId,
      naming,
    });
    if (name.length > GCS_BUCKET_NAME_MAX_LENGTH) {
      throw new CliError(
        `Storage bucket name "${name}" is ${name.length} characters; GCS takes at most ${GCS_BUCKET_NAME_MAX_LENGTH}`,
        commandName,
        `GCS bucket names are {project}-{bucket}-{env}-{suffix}. Shorten the bucket name (remove-bucket-storage, then add-bucket-storage) or the project name.`,
      );
    }
  }
}
