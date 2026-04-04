/**
 * Disable Cloud SQL Deletion Protection
 *
 * Uses googleapis SQL Admin API to disable deletion protection on a Cloud SQL instance.
 * This must be done before `terraform destroy` can delete the instance.
 */

import { google } from 'googleapis';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

export interface DisableDeletionProtectionOptions {
  instanceName: string;
  projectId: string;
  credentials: GCPCredentials;
}

export interface DisableDeletionProtectionResult {
  success: boolean;
  wasAlreadyDisabled?: boolean;
  error?: string;
}

/**
 * Disable deletion protection on a Cloud SQL instance
 *
 * Checks current state first — only patches if protection is enabled.
 */
export async function disableDeletionProtection(
  options: DisableDeletionProtectionOptions,
): Promise<DisableDeletionProtectionResult> {
  const auth = new google.auth.GoogleAuth({
    projectId: options.projectId,
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
    // Check current state
    const instance = await sql.instances.get({
      project: options.projectId,
      instance: options.instanceName,
    });

    if (!instance.data.settings?.deletionProtectionEnabled) {
      return { success: true, wasAlreadyDisabled: true };
    }

    // Disable deletion protection
    await sql.instances.patch({
      project: options.projectId,
      instance: options.instanceName,
      requestBody: {
        settings: {
          deletionProtectionEnabled: false,
        },
      },
    });

    return { success: true };
  } catch (error: unknown) {
    // Instance not found — nothing to disable
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: number }).code === 404
    ) {
      return { success: true, wasAlreadyDisabled: true };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
