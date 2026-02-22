/**
 * Delete Storage Account
 *
 * Deletes an Azure Storage Account (used for SPA hosting).
 * Idempotent: Returns success if Storage Account doesn't exist.
 */

import { StorageManagementClient } from '@azure/arm-storage';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from 'tsdevstack/plugin';
import { buildRuntime } from '../../build-runtime';

export interface DeleteStorageAccountOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  storageAccountName: string;
}

export interface DeleteStorageAccountResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete an Azure Storage Account
 */
export async function deleteStorageAccount(
  options: DeleteStorageAccountOptions,
): Promise<DeleteStorageAccountResult> {
  const { credentials, resourceGroupName, storageAccountName } = options;
  const runtime = buildRuntime();

  const credential = createAzureCredential(runtime, credentials);

  const storageClient = new StorageManagementClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    await storageClient.storageAccounts.delete(
      resourceGroupName,
      storageAccountName,
    );

    return { success: true, deleted: true };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };

    // 404 means already deleted
    if (error.statusCode === 404) {
      return { success: true, deleted: false };
    }

    return {
      success: false,
      deleted: false,
      error: error.message || 'Unknown error deleting Storage Account',
    };
  }
}
