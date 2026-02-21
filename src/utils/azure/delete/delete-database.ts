/**
 * Delete PostgreSQL Flexible Server Database
 *
 * Deletes a single database from an Azure PostgreSQL Flexible Server.
 * Idempotent: Returns success if database doesn't exist.
 */

import { PostgreSQLManagementFlexibleServerClient } from '@azure/arm-postgresql-flexible';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';

export interface DeleteDatabaseOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  serverName: string;
  databaseName: string;
}

export interface DeleteDatabaseResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete a database from Azure PostgreSQL Flexible Server
 */
export async function deleteDatabase(
  options: DeleteDatabaseOptions,
): Promise<DeleteDatabaseResult> {
  const { credentials, resourceGroupName, serverName, databaseName } = options;
  const runtime = buildRuntime();

  const credential = createAzureCredential(runtime, credentials);

  const client = new PostgreSQLManagementFlexibleServerClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    await client.databases.beginDeleteAndWait(
      resourceGroupName,
      serverName,
      databaseName,
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
      error: error.message || 'Unknown error deleting database',
    };
  }
}
