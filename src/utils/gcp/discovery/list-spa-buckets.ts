/**
 * List SPA buckets for a project
 *
 * Finds GCS buckets matching the pattern {projectName}-{serviceName}-spa.
 * Used to discover deployed SPA services.
 */

import { Storage } from '@google-cloud/storage';
import type { GCPCredentials } from 'tsdevstack/plugin';
import { getContext } from '../../../context';

export interface ListSpaBucketsOptions {
  projectName: string;
  projectId: string;
  credentials: GCPCredentials;
}

export interface SpaBucketInfo {
  /** Extracted service name (e.g., "landing-page" from "myproject-landing-page-spa") */
  serviceName: string;
  /** Full bucket name (e.g., "myproject-landing-page-spa") */
  bucketName: string;
}

export interface ListSpaBucketsResult {
  success: boolean;
  buckets: SpaBucketInfo[];
  error?: string;
}

/**
 * List all SPA buckets for a project
 *
 * Finds buckets matching {projectName}-*-spa pattern and extracts service names.
 *
 * @param options - Project name and credentials
 * @returns List of SPA buckets found with extracted service names
 */
export async function listSpaBuckets(
  options: ListSpaBucketsOptions,
): Promise<ListSpaBucketsResult> {
  const { buildGCPClientOptions } = getContext();

  const storage = new Storage({
    ...buildGCPClientOptions(options.credentials),
    projectId: options.projectId,
  });

  const prefix = `${options.projectName}-`;
  const suffix = '-spa';

  try {
    const [allBuckets] = await storage.getBuckets();

    const spaBuckets: SpaBucketInfo[] = [];

    for (const bucket of allBuckets) {
      const bucketName = bucket.name;

      // Check if bucket matches pattern: {projectName}-{serviceName}-spa
      if (bucketName.startsWith(prefix) && bucketName.endsWith(suffix)) {
        // Extract service name: remove prefix and suffix
        const serviceName = bucketName.slice(prefix.length, -suffix.length);

        // Skip if extraction resulted in empty string
        if (serviceName) {
          spaBuckets.push({
            serviceName,
            bucketName,
          });
        }
      }
    }

    return {
      success: true,
      buckets: spaBuckets,
    };
  } catch (error: unknown) {
    return {
      success: false,
      buckets: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
