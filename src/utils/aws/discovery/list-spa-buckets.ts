/**
 * List S3 SPA Buckets
 *
 * Lists all S3 buckets that are used for SPA deployments.
 * Bucket naming convention: ${projectName}-${serviceName}-spa
 */

import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from 'tsdevstack/plugin';

export interface ListSpaBucketsOptions {
  projectName: string;
  credentials: AWSCredentials;
}

export interface SpaBucketInfo {
  /** Full bucket name (e.g., tsdevstack-frontend-spa) */
  name: string;
  /** Service name extracted from bucket (e.g., frontend) */
  serviceName: string;
}

export interface ListSpaBucketsResult {
  success: boolean;
  buckets: SpaBucketInfo[];
  error?: string;
}

/**
 * List all SPA buckets for a project
 */
export async function listSpaBuckets(
  options: ListSpaBucketsOptions,
): Promise<ListSpaBucketsResult> {
  const { projectName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new S3Client(clientConfig);

  try {
    const response = await client.send(new ListBucketsCommand({}));

    const allBuckets = response.Buckets ?? [];

    // Filter to buckets matching our SPA naming pattern: {project}-{service}-spa
    const spaPrefix = `${projectName}-`;
    const spaSuffix = '-spa';

    const spaBuckets = allBuckets.filter((bucket) => {
      const name = bucket.Name ?? '';
      return name.startsWith(spaPrefix) && name.endsWith(spaSuffix);
    });

    const buckets: SpaBucketInfo[] = spaBuckets.map((bucket) => {
      const name = bucket.Name ?? '';
      // Extract service name: "project-servicename-spa" -> "servicename"
      const withoutPrefix = name.slice(spaPrefix.length);
      const serviceName = withoutPrefix.slice(
        0,
        withoutPrefix.length - spaSuffix.length,
      );

      return {
        name,
        serviceName,
      };
    });

    return { success: true, buckets };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, buckets: [], error: message };
  }
}
