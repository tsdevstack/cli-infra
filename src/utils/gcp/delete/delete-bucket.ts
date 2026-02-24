/**
 * Delete GCS Bucket
 *
 * Uses @google-cloud/storage to delete all files then the bucket.
 * Idempotent: Returns success if bucket already deleted.
 */

import { Storage } from '@google-cloud/storage';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

export interface DeleteBucketOptions {
  bucketName: string;
  credentials: GCPCredentials;
}

export interface DeleteBucketResult {
  success: boolean;
  deleted: boolean;
  alreadyGone?: boolean;
  filesDeleted?: number;
  error?: string;
}

/**
 * Delete a GCS bucket and all its contents
 *
 * Idempotent: Returns success if bucket already deleted.
 *
 * @param options - Bucket name and credentials
 * @returns Result indicating success/failure
 */
export async function deleteBucket(
  options: DeleteBucketOptions,
): Promise<DeleteBucketResult> {
  const { buildGCPClientOptions } = getContext();

  const storage = new Storage(buildGCPClientOptions(options.credentials));
  const bucket = storage.bucket(options.bucketName);

  try {
    // Check if bucket exists
    const [exists] = await bucket.exists();
    if (!exists) {
      return { success: true, deleted: false, alreadyGone: true };
    }

    // Delete all files in the bucket first
    const [files] = await bucket.getFiles();
    const filesDeleted = files.length;

    if (filesDeleted > 0) {
      await bucket.deleteFiles({ force: true });
    }

    // Now delete the bucket
    await bucket.delete();

    return { success: true, deleted: true, filesDeleted };
  } catch (error: unknown) {
    // 404 means already deleted - this is success for idempotency
    if (
      error instanceof Error &&
      (error.message.includes('404') || error.message.includes('Not Found'))
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
