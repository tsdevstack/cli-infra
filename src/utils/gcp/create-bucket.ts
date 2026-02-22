/**
 * Create GCS Bucket
 *
 * Generic function to create a GCS bucket with configurable options.
 */

import { Storage } from '@google-cloud/storage';
import type { GCPCredentials } from 'tsdevstack/plugin';
import { getContext } from '../../context';

export interface CreateBucketOptions {
  /** GCS bucket name */
  bucketName: string;
  /** GCP credentials */
  credentials: GCPCredentials;
  /** Storage location (default: 'US') */
  location?: string;
  /** Enable versioning (default: false) */
  versioning?: boolean;
  /** Custom labels for the bucket */
  labels?: Record<string, string>;
}

export interface CreateBucketResult {
  success: boolean;
  bucketName: string;
  isNew: boolean;
  error?: string;
}

/**
 * Creates a GCS bucket with the specified options
 *
 * @param options - Bucket configuration options
 * @returns Result indicating success/failure and whether bucket was created
 */
export async function createBucket(
  options: CreateBucketOptions,
): Promise<CreateBucketResult> {
  const {
    bucketName,
    credentials,
    location = 'US',
    versioning = false,
    labels = {},
  } = options;

  const { buildGCPClientOptions } = getContext();

  // Create Storage client (supports ADC mode)
  const storage = new Storage(buildGCPClientOptions(credentials));

  try {
    // Check if bucket exists
    const [exists] = await storage.bucket(bucketName).exists();

    if (exists) {
      return {
        success: true,
        bucketName,
        isNew: false,
      };
    }

    // Create bucket
    await storage.createBucket(bucketName, {
      location,
      storageClass: 'STANDARD',
      versioning: {
        enabled: versioning,
      },
      labels: {
        'managed-by': 'tsdevstack',
        ...labels,
      },
    });

    return {
      success: true,
      bucketName,
      isNew: true,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      bucketName,
      isNew: false,
      error: errorMessage,
    };
  }
}
