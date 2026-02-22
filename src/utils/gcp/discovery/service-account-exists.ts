/**
 * Check if a service account exists
 *
 * Uses googleapis IAM API to check service account existence.
 */

import { google } from 'googleapis';
import type { GCPCredentials } from 'tsdevstack/plugin';

export interface ServiceAccountExistsOptions {
  serviceAccountEmail: string;
  projectId: string;
  credentials: GCPCredentials;
}

export interface ServiceAccountExistsResult {
  exists: boolean;
  error?: string;
}

/**
 * Check if a service account exists
 *
 * @param options - Service account email and credentials
 * @returns Result indicating if the service account exists
 */
export async function serviceAccountExists(
  options: ServiceAccountExistsOptions,
): Promise<ServiceAccountExistsResult> {
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
    await iam.projects.serviceAccounts.get({ name });
    return { exists: true };
  } catch (error: unknown) {
    // 404 means service account doesn't exist - not an error
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
