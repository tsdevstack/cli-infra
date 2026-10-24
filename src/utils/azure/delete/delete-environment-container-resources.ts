/**
 * Delete Environment Container Resources
 *
 * Deletes what deploys create with the SDK in an environment's Container Apps
 * environment: every Container App (services and workers) and the database
 * migration jobs. Terraform does not manage them, and Azure refuses to delete
 * a managed environment that still holds Container Apps, so infra:destroy
 * runs this before Terraform. The scheduled jobs belong to Terraform and are
 * left to it. Deletes run in parallel; a failure is reported, not thrown.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';
import { AZURE_MIGRATION_JOB_PREFIX } from '../../../constants';

export interface DeleteEnvironmentContainerResourcesOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  /** Name of the Container Apps managed environment ({project}-{env}-cae) */
  environmentName: string;
}

export interface DeleteEnvironmentContainerResourcesResult {
  deleted: string[];
  failed: Array<{ name: string; error: string }>;
}

export async function deleteEnvironmentContainerResources(
  options: DeleteEnvironmentContainerResourcesOptions,
): Promise<DeleteEnvironmentContainerResourcesResult> {
  const { credentials, resourceGroupName, environmentName } = options;
  const client = new ContainerAppsAPIClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );
  const inEnvironment = (id: string | undefined): boolean =>
    id !== undefined &&
    id
      .toLowerCase()
      .endsWith(`/managedenvironments/${environmentName.toLowerCase()}`);

  const targets: Array<{ name: string; remove: () => Promise<void> }> = [];
  try {
    for await (const app of client.containerApps.listByResourceGroup(
      resourceGroupName,
    )) {
      const name = app.name;
      if (
        name &&
        inEnvironment(app.managedEnvironmentId ?? app.environmentId)
      ) {
        targets.push({
          name,
          remove: () =>
            client.containerApps.beginDeleteAndWait(resourceGroupName, name),
        });
      }
    }
    for await (const job of client.jobs.listByResourceGroup(
      resourceGroupName,
    )) {
      const name = job.name;
      if (
        name?.startsWith(AZURE_MIGRATION_JOB_PREFIX) &&
        inEnvironment(job.environmentId)
      ) {
        targets.push({
          name,
          remove: () => client.jobs.beginDeleteAndWait(resourceGroupName, name),
        });
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };
    // No resource group: nothing left to delete
    if (error.statusCode === 404) return { deleted: [], failed: [] };
    return {
      deleted: [],
      failed: [
        {
          name: resourceGroupName,
          error: error.message || 'Unknown error listing Container Apps',
        },
      ],
    };
  }

  const results = await Promise.allSettled(targets.map((t) => t.remove()));
  const result: DeleteEnvironmentContainerResourcesResult = {
    deleted: [],
    failed: [],
  };
  results.forEach((outcome, i) => {
    const name = targets[i].name;
    const error =
      outcome.status === 'rejected'
        ? (outcome.reason as { statusCode?: number; message?: string })
        : undefined;
    if (error === undefined || error.statusCode === 404) {
      result.deleted.push(name);
    } else {
      result.failed.push({
        name,
        error: error.message || 'Unknown error deleting',
      });
    }
  });
  return result;
}
