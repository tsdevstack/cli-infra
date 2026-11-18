/**
 * Delete CloudFront Distribution
 *
 * CloudFront deletes only a disabled distribution whose change has
 * finished spreading to the edge. So: disable it (if it isn't), wait until
 * its status is "Deployed" (several minutes), then delete it.
 * Idempotent: a distribution that is already gone counts as deleted, and a
 * run stopped halfway picks up from wherever the distribution is.
 */

import {
  CloudFrontClient,
  DeleteDistributionCommand,
  GetDistributionCommand,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  waitUntilDistributionDeployed,
} from '@aws-sdk/client-cloudfront';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';

export interface DeleteCloudFrontDistributionOptions {
  distributionId: string;
  credentials: AWSCredentials;
  /** How long to wait for the disabled distribution to deploy, in seconds */
  maxWaitSeconds?: number;
}

export interface DeleteCloudFrontDistributionResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Disable, wait and delete a CloudFront distribution
 */
export async function deleteCloudFrontDistribution(
  options: DeleteCloudFrontDistributionOptions,
): Promise<DeleteCloudFrontDistributionResult> {
  const { distributionId, credentials, maxWaitSeconds = 1800 } = options;
  // CloudFront is global; its API lives in us-east-1
  const client = new CloudFrontClient({
    ...buildAWSClientConfig(credentials),
    region: 'us-east-1',
  });

  try {
    const current = await client.send(
      new GetDistributionConfigCommand({ Id: distributionId }),
    );
    if (current.DistributionConfig?.Enabled) {
      await client.send(
        new UpdateDistributionCommand({
          Id: distributionId,
          IfMatch: current.ETag,
          DistributionConfig: {
            ...current.DistributionConfig,
            Enabled: false,
          },
        }),
      );
    }

    await waitUntilDistributionDeployed(
      { client, maxWaitTime: maxWaitSeconds },
      { Id: distributionId },
    );

    // Deleting needs the ETag of the disabled, deployed version
    const disabled = await client.send(
      new GetDistributionCommand({ Id: distributionId }),
    );
    await client.send(
      new DeleteDistributionCommand({
        Id: distributionId,
        IfMatch: disabled.ETag,
      }),
    );
    return { success: true, deleted: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchDistribution') {
      return { success: true, deleted: false };
    }
    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
