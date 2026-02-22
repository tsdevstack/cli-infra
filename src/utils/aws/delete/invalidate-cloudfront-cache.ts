/**
 * Invalidate CloudFront Cache
 *
 * Creates a cache invalidation for a CloudFront distribution.
 * Used during service removal to clear cached content.
 */

import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import type { AWSCredentials } from 'tsdevstack/plugin';
import { getContext } from '../../../context';

export interface InvalidateCloudFrontCacheOptions {
  /** CloudFront distribution ID */
  distributionId: string;
  /** Paths to invalidate (defaults to ['/*'] for all) */
  paths?: string[];
  /** AWS credentials */
  credentials: AWSCredentials;
}

export interface InvalidateCloudFrontCacheResult {
  success: boolean;
  deleted: boolean; // Always true if success (for consistency with other delete functions)
  error?: string;
}

/**
 * Create a CloudFront cache invalidation
 *
 * Note: This doesn't fail if distribution doesn't exist - the caller
 * should check distribution existence before calling this.
 */
export async function invalidateCloudFrontCache(
  options: InvalidateCloudFrontCacheOptions,
): Promise<InvalidateCloudFrontCacheResult> {
  const { distributionId, paths = ['/*'], credentials } = options;
  const { isCIEnv } = getContext();

  // Build CloudFront client config
  const clientConfig: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  } = {
    region: 'us-east-1', // CloudFront is global, uses us-east-1
  };

  // Only set explicit credentials in local mode
  if (!isCIEnv()) {
    clientConfig.credentials = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    };
  }

  const cloudfront = new CloudFrontClient(clientConfig);

  try {
    await cloudfront.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `remove-service-${Date.now()}`,
          Paths: {
            Quantity: paths.length,
            Items: paths,
          },
        },
      }),
    );

    return {
      success: true,
      deleted: true, // Cache invalidated successfully
    };
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string };

    // NoSuchDistribution means distribution already deleted
    if (error.name === 'NoSuchDistribution') {
      return { success: true, deleted: false };
    }

    return {
      success: false,
      deleted: false,
      error: error.message || 'Unknown error creating CloudFront invalidation',
    };
  }
}
