/**
 * Storage Account Exists
 *
 * Checks if an Azure Storage Account exists (used for SPA hosting).
 */

import { StorageManagementClient } from '@azure/arm-storage';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

export interface StorageAccountExistsOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  storageAccountName: string;
}

export interface StorageAccountExistsResult {
  exists: boolean;
  error?: string;
}

/**
 * Check if an Azure Storage Account exists
 */
export async function storageAccountExists(
  options: StorageAccountExistsOptions,
): Promise<StorageAccountExistsResult> {
  const { credentials, resourceGroupName, storageAccountName } = options;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const storageClient = new StorageManagementClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    await storageClient.storageAccounts.getProperties(
      resourceGroupName,
      storageAccountName,
    );
    return { exists: true };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };

    if (error.statusCode === 404) {
      return { exists: false };
    }

    return {
      exists: false,
      error: error.message || 'Unknown error checking Storage Account',
    };
  }
}
