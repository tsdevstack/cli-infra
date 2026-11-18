/**
 * Create GCS Bucket
 *
 * Generic function to create a GCS bucket with configurable options.
 * Every bucket gets uniform bucket-level access and public access
 * prevention; an existing bucket without them gets them too.
 */

import { Storage } from '@google-cloud/storage';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
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
  /** An existing bucket got uniform access and public access prevention now */
  accessUpdated: boolean;
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

  // Access by IAM only (no per-file ACLs), and nobody can make the bucket
  // or a file public
  const iamConfiguration = {
    uniformBucketLevelAccess: { enabled: true },
    publicAccessPrevention: 'enforced',
  };

  try {
    // Check if bucket exists
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();

    if (exists) {
      // A bucket made by an older CLI: add the access settings it lacks
      const [metadata] = await bucket.getMetadata();
      const current = metadata.iamConfiguration;
      const accessUpdated =
        current?.uniformBucketLevelAccess?.enabled !== true ||
        current?.publicAccessPrevention !== 'enforced';
      if (accessUpdated) {
        await bucket.setMetadata({ iamConfiguration });
      }
      return {
        success: true,
        bucketName,
        isNew: false,
        accessUpdated,
      };
    }

    // Create bucket
    await storage.createBucket(bucketName, {
      location,
      storageClass: 'STANDARD',
      versioning: {
        enabled: versioning,
      },
      iamConfiguration,
      labels: {
        'managed-by': 'tsdevstack',
        ...labels,
      },
    });

    return {
      success: true,
      bucketName,
      isNew: true,
      accessUpdated: false,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      bucketName,
      isNew: false,
      accessUpdated: false,
      error: errorMessage,
    };
  }
}
