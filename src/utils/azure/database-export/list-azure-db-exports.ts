/**
 * Saved databases in the exports container (Azure)
 */

import { StorageManagementClient } from '@azure/arm-storage';
import {
  ContainerClient,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';
import { parseDbExportFileName } from '../../database-export/parse-db-export-file-name';
import type { DbExportFile } from '../../database-export/types';
import type { AzureDbExports } from './get-azure-db-exports';

/**
 * Lists {service}/ in the container (the whole container without a
 * service) with the storage account's key, which the deploy account reads
 * (Contributor), the same way the SPA upload does. Files with other names
 * are left out.
 *
 * @param options.exports - The storage account and the container
 * @param options.resourceGroupName - The environment's resource group
 * @param options.serviceName - The service (all services when left out)
 * @param options.credentials - The deploy account
 * @returns The files, newest first
 */
export async function listAzureDbExports(options: {
  exports: AzureDbExports;
  resourceGroupName: string;
  serviceName?: string;
  credentials: AzureCredentials;
}): Promise<DbExportFile[]> {
  const { exports, credentials } = options;
  const storage = new StorageManagementClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );
  const { keys } = await storage.storageAccounts.listKeys(
    options.resourceGroupName,
    exports.storageAccount,
  );
  const key = keys?.[0]?.value;
  if (!key) {
    throw new Error(`No key for the storage account ${exports.storageAccount}`);
  }
  const container = new ContainerClient(
    exports.containerUrl,
    new StorageSharedKeyCredential(exports.storageAccount, key),
  );

  const files: DbExportFile[] = [];
  for await (const blob of container.listBlobsFlat(
    options.serviceName ? { prefix: `${options.serviceName}/` } : {},
  )) {
    const parsed = parseDbExportFileName(blob.name);
    if (
      parsed &&
      (!options.serviceName || parsed.serviceName === options.serviceName)
    ) {
      files.push({ ...parsed, size: blob.properties.contentLength ?? 0 });
    }
  }
  return files.sort((a, b) => b.time.getTime() - a.time.getTime());
}
