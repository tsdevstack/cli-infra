/**
 * Check S3 Bucket Exists (AWS)
 *
 * Checks if an S3 bucket exists by attempting to get its location.
 */

import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface BucketExistsOptions {
  bucketName: string;
  credentials: AWSCredentials;
}

export interface BucketExistsResult {
  exists: boolean;
  error?: string;
}

/**
 * Check if an S3 bucket exists
 */
export async function bucketExists(
  options: BucketExistsOptions,
): Promise<BucketExistsResult> {
  const { bucketName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new S3Client(clientConfig);

  try {
    const command = new HeadBucketCommand({
      Bucket: bucketName,
    });

    await client.send(command);

    return {
      exists: true,
    };
  } catch (error) {
    // NotFound or 404 means bucket doesn't exist
    if (
      error instanceof Error &&
      (error.name === 'NotFound' ||
        error.name === 'NoSuchBucket' ||
        error.message.includes('404'))
    ) {
      return {
        exists: false,
      };
    }

    // Other errors (permission denied, etc.)
    return {
      exists: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
