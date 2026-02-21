/**
 * Check if a GCS bucket exists
 *
 * Uses @google-cloud/storage to check bucket existence.
 */

import { Storage } from '@google-cloud/storage';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

export interface BucketExistsOptions {
  bucketName: string;
  credentials: GCPCredentials;
}

export interface BucketExistsResult {
  exists: boolean;
  error?: string;
}

/**
 * Check if a GCS bucket exists
 *
 * @param options - Bucket name and credentials
 * @returns Result indicating if the bucket exists
 */
export async function bucketExists(
  options: BucketExistsOptions
): Promise<BucketExistsResult> {
  const { buildGCPClientOptions } = getContext();

  const storage = new Storage(buildGCPClientOptions(options.credentials));

  try {
    const [exists] = await storage.bucket(options.bucketName).exists();
    return { exists };
  } catch (error: unknown) {
    return {
      exists: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}