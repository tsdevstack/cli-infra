/**
 * Create Azure Terraform State Backend
 *
 * Creates Storage Account + Blob Container for Terraform state management.
 * Azure uses Blob leases for state locking (built-in, no separate table needed).
 */

import {
  StorageManagementClient,
  type StorageAccount,
} from '@azure/arm-storage';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';

export interface CreateStateBackendOptions {
  projectName: string;
  env: string;
  credentials: AzureCredentials;
}

export interface CreateStateBackendResult {
  success: boolean;
  storageAccountName: string;
  containerName: string;
  storageAccountCreated: boolean;
  containerCreated: boolean;
  error?: string;
}

/**
 * Build the storage account name for Terraform state.
 * Azure Storage Account names: 3-24 chars, lowercase alphanumeric only, globally unique.
 */
function buildStorageAccountName(projectName: string, env: string): string {
  const sanitized = projectName.replace(/[^a-z0-9]/g, '');
  return `${sanitized}${env}tfstate`;
}

/**
 * Create Storage Account and Blob Container for Terraform state
 */
export async function createStateBackend(
  options: CreateStateBackendOptions,
): Promise<CreateStateBackendResult> {
  const { projectName, env, credentials } = options;

  const resourceGroupName = `${projectName}-${env}-rg`;
  const storageAccountName = buildStorageAccountName(projectName, env);
  const containerName = 'tfstate';
  const runtime = buildRuntime();

  const credential = createAzureCredential(runtime, credentials);

  const storageClient = new StorageManagementClient(
    credential,
    credentials.subscriptionId,
  );

  let storageAccountCreated = false;
  let containerCreated = false;

  try {
    // Step 1: Check/create Storage Account
    let existingAccount: StorageAccount | undefined;
    try {
      existingAccount = await storageClient.storageAccounts.getProperties(
        resourceGroupName,
        storageAccountName,
      );
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 404) {
        throw err;
      }
    }

    if (!existingAccount) {
      await storageClient.storageAccounts.beginCreateAndWait(
        resourceGroupName,
        storageAccountName,
        {
          location: credentials.location,
          kind: 'StorageV2',
          sku: { name: 'Standard_LRS' },
          allowBlobPublicAccess: false,
          minimumTlsVersion: 'TLS1_2',
          tags: {
            'managed-by': 'tsdevstack',
            project: projectName,
            environment: env,
            purpose: 'terraform-state',
          },
        },
      );

      // Enable blob versioning for state history
      await storageClient.blobServices.setServiceProperties(
        resourceGroupName,
        storageAccountName,
        {
          isVersioningEnabled: true,
        },
      );

      storageAccountCreated = true;
    }

    // Step 2: Check/create Blob Container
    try {
      await storageClient.blobContainers.get(
        resourceGroupName,
        storageAccountName,
        containerName,
      );
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404) {
        await storageClient.blobContainers.create(
          resourceGroupName,
          storageAccountName,
          containerName,
          {},
        );
        containerCreated = true;
      } else {
        throw err;
      }
    }

    return {
      success: true,
      storageAccountName,
      containerName,
      storageAccountCreated,
      containerCreated,
    };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      success: false,
      storageAccountName,
      containerName,
      storageAccountCreated,
      containerCreated,
      error: error.message || 'Unknown error',
    };
  }
}
