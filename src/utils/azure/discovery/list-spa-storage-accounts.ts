/**
 * List SPA Storage Accounts
 *
 * Finds all SPA storage accounts in a resource group.
 * SPA storage accounts follow the naming pattern:
 *   {project}{env}{spaname}spa{subscriptionSuffix}
 * where subscriptionSuffix is the last 8 hex chars of the subscription ID.
 */

import { StorageManagementClient } from '@azure/arm-storage';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

export interface ListSpaStorageAccountsOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  projectName: string;
  targetEnv: string;
}

export interface SpaStorageAccountInfo {
  name: string;
  spaName: string;
}

export interface ListSpaStorageAccountsResult {
  success: boolean;
  accounts: SpaStorageAccountInfo[];
  error?: string;
}

/**
 * List all SPA storage accounts in a resource group
 */
export async function listSpaStorageAccounts(
  options: ListSpaStorageAccountsOptions,
): Promise<ListSpaStorageAccountsResult> {
  const { credentials, resourceGroupName, projectName, targetEnv } = options;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const storageClient = new StorageManagementClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    const accounts: SpaStorageAccountInfo[] = [];
    // SPA storage account naming: {project}{env}{spaname}spa{subSuffix}
    // subSuffix = last 8 hex chars of subscriptionId (no dashes)
    const sanitizedProject = projectName.replace(/[^a-z0-9]/g, '');
    const prefix = `${sanitizedProject}${targetEnv}`;
    const subSuffix = credentials.subscriptionId.replace(/-/g, '').slice(-8);

    for await (const account of storageClient.storageAccounts.listByResourceGroup(
      resourceGroupName,
    )) {
      if (
        account.name &&
        account.name.startsWith(prefix) &&
        account.name.endsWith(subSuffix)
      ) {
        // Extract SPA name: between prefix and "spa" + subSuffix
        const middle = account.name.slice(prefix.length, -subSuffix.length);
        // Remove trailing "spa" marker (may be truncated for long names)
        const spaName = middle.endsWith('spa') ? middle.slice(0, -3) : middle;

        if (spaName) {
          accounts.push({
            name: account.name,
            spaName,
          });
        }
      }
    }

    return { success: true, accounts };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      success: false,
      accounts: [],
      error: error.message || 'Unknown error listing SPA storage accounts',
    };
  }
}
