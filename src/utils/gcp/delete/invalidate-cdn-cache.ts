/**
 * Invalidate CDN Cache
 *
 * Uses googleapis Compute API to invalidate CDN cache for a URL map.
 * Used when deleting SPA services to ensure cached content is purged.
 */

import { google } from 'googleapis';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

export interface InvalidateCdnCacheOptions {
  urlMapName: string;
  projectId: string;
  credentials: GCPCredentials;
  /** Path pattern to invalidate (default: '/*' for all) */
  path?: string;
}

export interface InvalidateCdnCacheResult {
  success: boolean;
  error?: string;
}

/**
 * Invalidate CDN cache for a URL map
 *
 * @param options - URL map name and credentials
 * @returns Result indicating success/failure
 */
export async function invalidateCdnCache(
  options: InvalidateCdnCacheOptions
): Promise<InvalidateCdnCacheResult> {
  const auth = new google.auth.GoogleAuth({
    projectId: options.projectId,
    // Only pass credentials if we have a private key (not ADC mode)
    ...(options.credentials.private_key && {
      credentials: {
        client_email: options.credentials.client_email,
        private_key: options.credentials.private_key,
      },
    }),
    scopes: ['https://www.googleapis.com/auth/compute'],
  });

  const compute = google.compute({ version: 'v1', auth });

  try {
    const response = await compute.urlMaps.invalidateCache({
      project: options.projectId,
      urlMap: options.urlMapName,
      requestBody: {
        path: options.path ?? '/*',
      },
    });

    // Wait for operation to complete if there's an operation object
    if (response.data?.name) {
      await waitForGlobalOperation(
        compute,
        options.projectId,
        response.data.name
      );
    }

    return { success: true };
  } catch (error: unknown) {
    // 404 for URL map means nothing to invalidate - treat as success
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: number }).code === 404
    ) {
      return { success: true };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Wait for a global compute operation to complete
 */
async function waitForGlobalOperation(
  compute: ReturnType<typeof google.compute>,
  projectId: string,
  operationName: string,
  maxWaitMs: number = 60000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await compute.globalOperations.get({
      project: projectId,
      operation: operationName,
    });

    if (result.data?.status === 'DONE') {
      if (result.data.error) {
        throw new Error(
          `Operation failed: ${JSON.stringify(result.data.error)}`
        );
      }
      return;
    }

    // Wait 2 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Operation ${operationName} timed out after ${maxWaitMs}ms`);
}