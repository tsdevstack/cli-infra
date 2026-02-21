/**
 * Delete S3 Bucket
 *
 * Empties and deletes an S3 bucket.
 * Idempotent: Returns success if bucket doesn't exist.
 */

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  NoSuchBucket,
} from '@aws-sdk/client-s3';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface DeleteS3BucketOptions {
  bucketName: string;
  credentials: AWSCredentials;
}

export interface DeleteS3BucketResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete an S3 bucket (empties it first)
 *
 * Idempotent: Returns success if bucket already deleted.
 */
export async function deleteS3Bucket(
  options: DeleteS3BucketOptions,
): Promise<DeleteS3BucketResult> {
  const { bucketName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const s3 = new S3Client(clientConfig);

  try {
    // List all objects in the bucket
    let continuationToken: string | undefined;

    do {
      const listResponse = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
        }),
      );

      const objects = listResponse.Contents;

      if (objects && objects.length > 0) {
        // Delete all objects in this batch
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: objects.map((obj) => ({ Key: obj.Key! })),
              Quiet: true,
            },
          }),
        );
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    // Now delete the bucket
    await s3.send(
      new DeleteBucketCommand({
        Bucket: bucketName,
      }),
    );

    return { success: true, deleted: true };
  } catch (error) {
    // NoSuchBucket or 404 means already deleted
    if (
      error instanceof NoSuchBucket ||
      (error instanceof Error && error.name === 'NoSuchBucket') ||
      (error instanceof Error && error.name === 'NotFound')
    ) {
      return { success: true, deleted: false };
    }

    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
