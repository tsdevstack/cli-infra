/**
 * Upload File to Google Cloud Storage
 *
 * Uploads a single file to an existing GCS bucket.
 * Bucket must be created separately (via Terraform).
 */

import { Storage } from '@google-cloud/storage';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';

export interface UploadToGCSOptions {
  /** GCP project ID */
  projectId: string;
  /** GCS bucket name */
  bucketName: string;
  /** Object name (path within bucket) */
  objectName: string;
  /** Local file path to upload */
  filePath: string;
  /** GCP credentials */
  credentials: GCPCredentials;
}

export interface UploadToGCSResult {
  success: boolean;
  bucketName: string;
  objectName: string;
  error?: string;
}

/**
 * Upload a file to Google Cloud Storage
 *
 * Bucket must already exist (created by Terraform).
 */
export async function uploadToGCS(
  options: UploadToGCSOptions,
): Promise<UploadToGCSResult> {
  const { bucketName, objectName, filePath, credentials } = options;
  const { buildGCPClientOptions, CliError } = getContext();

  // Create Storage client (supports ADC mode)
  const storage = new Storage(buildGCPClientOptions(credentials));

  try {
    const bucket = storage.bucket(bucketName);

    // Upload file
    await bucket.upload(filePath, {
      destination: objectName,
      metadata: {
        contentType: 'application/zip',
      },
    });

    return {
      success: true,
      bucketName,
      objectName,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new CliError(
      'Failed to upload to Cloud Storage',
      'uploadToGCS',
      errorMessage,
    );
  }
}
