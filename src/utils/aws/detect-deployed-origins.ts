/**
 * Detect Deployed Origins
 *
 * Checks what S3 buckets exist so Terraform can conditionally create
 * CloudFront distributions only for SPA origins that have content.
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';

export interface DeployedOrigins {
  /** serviceName -> has content */
  spaBucketsReady: Record<string, boolean>;
}

export interface DetectDeployedOriginsOptions {
  credentials: AWSCredentials;
  projectName: string;
  environment: string;
  spaServices: string[];
}

/**
 * Detect deployed S3 bucket content for SPA services
 */
export async function detectDeployedOrigins(
  options: DetectDeployedOriginsOptions,
): Promise<DeployedOrigins> {
  const { logger, isCIEnv } = getContext();
  const { credentials, projectName, environment, spaServices } = options;

  // Build client config
  const clientConfig: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  } = {
    region: credentials.region,
  };

  if (!isCIEnv()) {
    clientConfig.credentials = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    };
  }

  const s3 = new S3Client(clientConfig);
  const spaBucketsReady: Record<string, boolean> = {};

  // Detect S3 bucket content
  if (spaServices.length > 0) {
    logger.info('Detecting SPA bucket content...');

    for (const serviceName of spaServices) {
      const bucketName = `${projectName}-${environment}-${serviceName}-spa`;

      try {
        const response = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            MaxKeys: 1,
          }),
        );

        const hasContent = (response.KeyCount ?? 0) > 0;
        spaBucketsReady[serviceName] = hasContent;

        if (hasContent) {
          logger.success(`  ✓ ${serviceName}: has content`);
        } else {
          logger.info(`  ${serviceName}: bucket empty`);
        }
      } catch {
        spaBucketsReady[serviceName] = false;
        logger.info(`  ${serviceName}: bucket not found`);
      }
    }
  }

  return { spaBucketsReady };
}
