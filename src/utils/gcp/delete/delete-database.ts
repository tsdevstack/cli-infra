/**
 * Delete Cloud SQL Database
 *
 * Uses googleapis SQL Admin API to delete a database.
 * Idempotent: NOT_FOUND is treated as success.
 */

import { google } from 'googleapis';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

export interface DeleteDatabaseOptions {
  databaseName: string;
  instanceName: string;
  projectId: string;
  credentials: GCPCredentials;
}

export interface DeleteDatabaseResult {
  success: boolean;
  deleted: boolean;
  alreadyGone?: boolean;
  error?: string;
}

/**
 * Delete a Cloud SQL database
 *
 * Idempotent: Returns success if database already deleted.
 *
 * @param options - Database name, instance name, and credentials
 * @returns Result indicating success/failure
 */
export async function deleteDatabase(
  options: DeleteDatabaseOptions,
): Promise<DeleteDatabaseResult> {
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
    await sql.databases.delete({
      project: options.projectId,
      instance: options.instanceName,
      database: options.databaseName,
    });
    return { success: true, deleted: true };
  } catch (error: unknown) {
    // 404 means already deleted - this is success for idempotency
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: number }).code === 404
    ) {
      return { success: true, deleted: false, alreadyGone: true };
    }
    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
