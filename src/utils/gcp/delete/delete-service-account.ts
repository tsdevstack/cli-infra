/**
 * Delete Service Account
 *
 * Uses googleapis IAM API to delete a service account.
 * Idempotent: NOT_FOUND is treated as success.
 *
 * Note: When a service account is deleted, its IAM bindings become
 * inactive immediately but are not fully purged from GCP until ~60 days
 * later. They appear with a `deleted:` prefix in the meantime.
 */

import { google } from 'googleapis';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

export interface DeleteServiceAccountOptions {
  serviceAccountEmail: string;
  projectId: string;
  credentials: GCPCredentials;
}

export interface DeleteServiceAccountResult {
  success: boolean;
  deleted: boolean;
  alreadyGone?: boolean;
  error?: string;
}

/**
 * Delete a service account
 *
 * Idempotent: Returns success if service account already deleted.
 *
 * @param options - Service account email and credentials
 * @returns Result indicating success/failure
 */
export async function deleteServiceAccount(
  options: DeleteServiceAccountOptions
): Promise<DeleteServiceAccountResult> {
  const auth = new google.auth.GoogleAuth({
    projectId: options.projectId,
    // Only pass credentials if we have a private key (not ADC mode)
    ...(options.credentials.private_key && {
      credentials: {
        client_email: options.credentials.client_email,
        private_key: options.credentials.private_key,
      },
    }),
    scopes: ['https://www.googleapis.com/auth/iam'],
  });

  const iam = google.iam({ version: 'v1', auth });
  const name = `projects/${options.projectId}/serviceAccounts/${options.serviceAccountEmail}`;

  try {
    await iam.projects.serviceAccounts.delete({ name });
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