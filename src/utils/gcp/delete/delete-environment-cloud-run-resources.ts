/**
 * Delete Environment Cloud Run Resources
 *
 * Deletes the Cloud Run services and jobs that deploys create with the SDK
 * (see getEnvironmentCloudRunNames). Terraform does not manage them, so
 * without this infra:destroy leaves them running (and billing), and they keep
 * the subnet in use. Deletes run in parallel; a resource that does not exist
 * counts as not found, a failure is reported, not thrown.
 */

import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { deleteCloudRunService } from './delete-cloud-run-service';
import { deleteCloudRunJob } from './delete-cloud-run-job';
import type { EnvironmentCloudRunNames } from './get-environment-cloud-run-names';

export interface DeleteEnvironmentCloudRunResourcesOptions {
  credentials: GCPCredentials;
  projectId: string;
  region: string;
  names: EnvironmentCloudRunNames;
}

export interface DeleteEnvironmentCloudRunResourcesResult {
  deleted: string[];
  notFound: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Delete an environment's Cloud Run services and jobs
 *
 * @param options - Credentials, project, region and the names to delete
 * @returns Deleted, not found and failed names
 */
export async function deleteEnvironmentCloudRunResources(
  options: DeleteEnvironmentCloudRunResourcesOptions,
): Promise<DeleteEnvironmentCloudRunResourcesResult> {
  const { credentials, projectId, region, names } = options;

  const targets = [
    ...names.services.map((serviceName) => ({
      name: serviceName,
      remove: () =>
        deleteCloudRunService({ serviceName, projectId, region, credentials }),
    })),
    ...names.jobs.map((jobName) => ({
      name: jobName,
      remove: () =>
        deleteCloudRunJob({ jobName, projectId, region, credentials }),
    })),
  ];

  const results = await Promise.all(targets.map((t) => t.remove()));

  const result: DeleteEnvironmentCloudRunResourcesResult = {
    deleted: [],
    notFound: [],
    failed: [],
  };
  results.forEach((outcome, i) => {
    const name = targets[i].name;
    if (!outcome.success) {
      result.failed.push({ name, error: outcome.error || 'Unknown error' });
    } else if (outcome.alreadyGone) {
      result.notFound.push(name);
    } else {
      result.deleted.push(name);
    }
  });
  return result;
}
