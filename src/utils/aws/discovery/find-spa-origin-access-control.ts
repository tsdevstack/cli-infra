/**
 * Find SPA Origin Access Control
 *
 * The CloudFront origin access control Terraform creates for an SPA
 * ("{project}-{service}-oac", generate-s3-spa-tf.ts). It lets the SPA's
 * distribution read the private bucket.
 */

import {
  CloudFrontClient,
  ListOriginAccessControlsCommand,
} from '@aws-sdk/client-cloudfront';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';

export interface FindSpaOriginAccessControlOptions {
  projectName: string;
  serviceName: string;
  credentials: AWSCredentials;
}

export interface FindSpaOriginAccessControlResult {
  success: boolean;
  /** Its ID, or undefined when the SPA has none */
  id?: string;
  error?: string;
}

/**
 * Find the SPA's origin access control by name
 */
export async function findSpaOriginAccessControl(
  options: FindSpaOriginAccessControlOptions,
): Promise<FindSpaOriginAccessControlResult> {
  const { projectName, serviceName, credentials } = options;
  // CloudFront is global; its API lives in us-east-1
  const client = new CloudFrontClient({
    ...buildAWSClientConfig(credentials),
    region: 'us-east-1',
  });
  const name = `${projectName}-${serviceName}-oac`;

  try {
    let marker: string | undefined;
    do {
      const response = await client.send(
        new ListOriginAccessControlsCommand({ Marker: marker }),
      );
      const list = response.OriginAccessControlList;
      const match = list?.Items?.find((item) => item.Name === name);
      if (match?.Id) {
        return { success: true, id: match.Id };
      }
      marker = list?.IsTruncated ? list.NextMarker : undefined;
    } while (marker);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
