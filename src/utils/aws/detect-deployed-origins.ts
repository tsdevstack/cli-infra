/**
 * Detect Deployed Origins
 *
 * Checks what App Runner services and S3 buckets exist so Terraform
 * can conditionally create CloudFront distributions only for origins that exist.
 */

import {
  AppRunnerClient,
  ListServicesCommand,
  DescribeServiceCommand,
} from '@aws-sdk/client-apprunner';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { AWSCredentials } from 'tsdevstack/plugin';
import { getContext } from '../../context';

export interface DeployedOrigins {
  /** serviceName -> App Runner URL (without https://) */
  nextjsOrigins: Record<string, string>;
  /** serviceName -> App Runner service ARN (for WAF association) */
  nextjsServiceArns: Record<string, string>;
  /** serviceName -> has content */
  spaBucketsReady: Record<string, boolean>;
}

export interface DetectDeployedOriginsOptions {
  credentials: AWSCredentials;
  projectName: string;
  environment: string;
  nextjsServices: string[];
  spaServices: string[];
}

/**
 * Detect deployed App Runner services and S3 bucket content
 */
export async function detectDeployedOrigins(
  options: DetectDeployedOriginsOptions,
): Promise<DeployedOrigins> {
  const { logger, isCIEnv } = getContext();
  const { credentials, projectName, environment, nextjsServices, spaServices } =
    options;

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

  const appRunner = new AppRunnerClient(clientConfig);
  const s3 = new S3Client(clientConfig);

  const nextjsOrigins: Record<string, string> = {};
  const nextjsServiceArns: Record<string, string> = {};
  const spaBucketsReady: Record<string, boolean> = {};

  // Detect App Runner services
  if (nextjsServices.length > 0) {
    logger.info('Detecting App Runner services...');

    try {
      const listResponse = await appRunner.send(new ListServicesCommand({}));
      const allServices = listResponse.ServiceSummaryList ?? [];

      for (const serviceName of nextjsServices) {
        const fullName = `${projectName}-${environment}-${serviceName}`;

        // Accept RUNNING or OPERATION_IN_PROGRESS (has URL, will be ready soon)
        const service = allServices.find(
          (s) =>
            s.ServiceName === fullName &&
            (s.Status === 'RUNNING' || s.Status === 'OPERATION_IN_PROGRESS'),
        );

        if (service?.ServiceArn) {
          try {
            const describeResponse = await appRunner.send(
              new DescribeServiceCommand({ ServiceArn: service.ServiceArn }),
            );

            if (describeResponse.Service?.ServiceUrl) {
              // App Runner URL without https://
              nextjsOrigins[serviceName] = describeResponse.Service.ServiceUrl;
              // Also capture ARN for WAF association
              if (describeResponse.Service.ServiceArn) {
                nextjsServiceArns[serviceName] =
                  describeResponse.Service.ServiceArn;
              }
              logger.success(
                `  ✓ ${serviceName} → ${describeResponse.Service.ServiceUrl}`,
              );
            }
          } catch {
            logger.info(`  ${serviceName}: not ready`);
          }
        } else {
          logger.info(`  ${serviceName}: not deployed yet`);
        }
      }
    } catch {
      logger.info('  No App Runner services found');
    }
  }

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

  return { nextjsOrigins, nextjsServiceArns, spaBucketsReady };
}
