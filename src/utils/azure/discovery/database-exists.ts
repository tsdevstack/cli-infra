/**
 * Check if a PostgreSQL Flexible Server database exists
 *
 * Queries Azure PostgreSQL Flexible Server directly to check database existence.
 */

import { PostgreSQLManagementFlexibleServerClient } from '@azure/arm-postgresql-flexible';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

export interface DatabaseExistsOptions {
  databaseName: string;
  serverName: string;
  resourceGroupName: string;
  credentials: AzureCredentials;
}

export interface DatabaseExistsResult {
  exists: boolean;
  error?: string;
}

/**
 * Check if a database exists on Azure PostgreSQL Flexible Server
 */
export async function databaseExists(
  options: DatabaseExistsOptions,
): Promise<DatabaseExistsResult> {
  const { databaseName, serverName, resourceGroupName, credentials } = options;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);
  const client = new PostgreSQLManagementFlexibleServerClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    await client.databases.get(resourceGroupName, serverName, databaseName);
    return { exists: true };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };

    if (error.statusCode === 404) {
      return { exists: false };
    }

    return {
      exists: false,
      error: error.message || 'Unknown error checking database',
    };
  }
}
