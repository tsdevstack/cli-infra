/**
 * Check if a Cloud SQL database exists
 *
 * Uses googleapis SQL Admin API to check database existence.
 */

import { google } from 'googleapis';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

export interface DatabaseExistsOptions {
  databaseName: string;
  instanceName: string;
  projectId: string;
  credentials: GCPCredentials;
}

export interface DatabaseExistsResult {
  exists: boolean;
  error?: string;
}

/**
 * Check if a Cloud SQL database exists
 *
 * @param options - Database name, instance name, and credentials
 * @returns Result indicating if the database exists
 */
export async function databaseExists(
  options: DatabaseExistsOptions,
): Promise<DatabaseExistsResult> {
  const auth = new google.auth.GoogleAuth({
    projectId: options.projectId,
    // Only pass credentials if we have a private key (not ADC mode)
    ...(options.credentials.private_key && {
      credentials: {
        client_email: options.credentials.client_email,
        private_key: options.credentials.private_key,
      },
    }),
    scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
  });

  const sql = google.sqladmin({ version: 'v1beta4', auth });

  try {
    await sql.databases.get({
      project: options.projectId,
      instance: options.instanceName,
      database: options.databaseName,
    });
    return { exists: true };
  } catch (error: unknown) {
    // 404 means database doesn't exist - not an error
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: number }).code === 404
    ) {
      return { exists: false };
    }
    return {
      exists: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
