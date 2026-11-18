/**
 * Find Service Distributions
 *
 * The CloudFront distributions a service has of its own on AWS, as
 * Terraform creates them:
 * - an SPA's distribution has the SPA's bucket as its origin
 *   (generate-s3-spa-tf.ts; it has no comment);
 * - a Next.js app's distribution has the comment
 *   "{project}-{env}-{service}-cdn" (generate-nextjs-cloudfront-tf.ts).
 * The API distribution is shared and never matches.
 */

import {
  CloudFrontClient,
  ListDistributionsCommand,
} from '@aws-sdk/client-cloudfront';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { buildAwsSpaBucketName } from '../build-aws-spa-bucket-name';

export interface ServiceDistribution {
  id: string;
  kind: 'spa' | 'nextjs';
}

export interface FindServiceDistributionsOptions {
  projectName: string;
  targetEnv: string;
  serviceName: string;
  credentials: AWSCredentials;
}

export interface FindServiceDistributionsResult {
  success: boolean;
  distributions: ServiceDistribution[];
  error?: string;
}

/**
 * List the account's distributions and keep the service's own
 */
export async function findServiceDistributions(
  options: FindServiceDistributionsOptions,
): Promise<FindServiceDistributionsResult> {
  const { projectName, targetEnv, serviceName, credentials } = options;
  // CloudFront is global; its API lives in us-east-1
  const client = new CloudFrontClient({
    ...buildAWSClientConfig(credentials),
    region: 'us-east-1',
  });

  const spaOriginPrefix = `${buildAwsSpaBucketName(projectName, serviceName, credentials.accountId)}.s3.`;
  const nextjsComment = `${projectName}-${targetEnv}-${serviceName}-cdn`;
  const distributions: ServiceDistribution[] = [];

  try {
    let marker: string | undefined;
    do {
      const response = await client.send(
        new ListDistributionsCommand({ Marker: marker }),
      );
      const list = response.DistributionList;
      for (const summary of list?.Items ?? []) {
        if (!summary.Id) continue;
        const origins = summary.Origins?.Items ?? [];
        if (
          origins.some((origin) =>
            origin.DomainName?.startsWith(spaOriginPrefix),
          )
        ) {
          distributions.push({ id: summary.Id, kind: 'spa' });
        } else if (summary.Comment === nextjsComment) {
          distributions.push({ id: summary.Id, kind: 'nextjs' });
        }
      }
      marker = list?.IsTruncated ? list.NextMarker : undefined;
    } while (marker);

    return { success: true, distributions };
  } catch (error) {
    return {
      success: false,
      distributions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
