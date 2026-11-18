/**
 * Delete Origin Access Control
 *
 * Deletes a CloudFront origin access control. CloudFront refuses while a
 * distribution still uses it, so it goes after the SPA's distribution.
 * Idempotent: one that is already gone counts as deleted.
 */

import {
  CloudFrontClient,
  DeleteOriginAccessControlCommand,
  GetOriginAccessControlCommand,
} from '@aws-sdk/client-cloudfront';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';

export interface DeleteOriginAccessControlOptions {
  originAccessControlId: string;
  credentials: AWSCredentials;
}

export interface DeleteOriginAccessControlResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete an origin access control
 */
export async function deleteOriginAccessControl(
  options: DeleteOriginAccessControlOptions,
): Promise<DeleteOriginAccessControlResult> {
  const { originAccessControlId, credentials } = options;
  // CloudFront is global; its API lives in us-east-1
  const client = new CloudFrontClient({
    ...buildAWSClientConfig(credentials),
    region: 'us-east-1',
  });

  try {
    // Deleting needs the current ETag
    const current = await client.send(
      new GetOriginAccessControlCommand({ Id: originAccessControlId }),
    );
    await client.send(
      new DeleteOriginAccessControlCommand({
        Id: originAccessControlId,
        IfMatch: current.ETag,
      }),
    );
    return { success: true, deleted: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchOriginAccessControl') {
      return { success: true, deleted: false };
    }
    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
