/**
 * Cleanup App Runner Services (Migration)
 *
 * One-time migration helper: detects and deletes App Runner services
 * that match the tsdevstack naming convention ({project}-{env}-{service}).
 * Required because App Runner was replaced with ECS Fargate for Next.js,
 * and Terraform cannot delete the App Runner auto-scaling config while
 * the App Runner service still references it.
 *
 * Safe: only deletes services matching the exact naming pattern.
 */

import {
  AppRunnerClient,
  ListServicesCommand,
  DeleteServiceCommand,
} from '@aws-sdk/client-apprunner';
import { getContext } from '../../../context';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface CleanupAppRunnerServicesOptions {
  projectName: string;
  targetEnv: string;
  credentials: AWSCredentials;
  nextjsServiceNames: string[];
}

/**
 * Delete App Runner services that match tsdevstack naming convention.
 * No-op if no matching services exist.
 */
export async function cleanupAppRunnerServices(
  options: CleanupAppRunnerServicesOptions,
): Promise<void> {
  const { logger, isCIEnv } = getContext();
  const { projectName, targetEnv, credentials, nextjsServiceNames } = options;

  if (nextjsServiceNames.length === 0) return;

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

  const client = new AppRunnerClient(clientConfig);

  // Build expected App Runner service names
  const expectedNames = nextjsServiceNames.map(
    (name) => `${projectName}-${targetEnv}-${name}`,
  );

  try {
    const response = await client.send(new ListServicesCommand({}));
    const allServices = response.ServiceSummaryList ?? [];

    for (const expectedName of expectedNames) {
      const service = allServices.find(
        (s) =>
          s.ServiceName === expectedName &&
          s.Status !== 'DELETED' &&
          s.Status !== 'DELETE_FAILED',
      );

      if (service?.ServiceArn) {
        logger.info(`  Removing legacy App Runner service: ${expectedName}...`);

        await client.send(
          new DeleteServiceCommand({ ServiceArn: service.ServiceArn }),
        );

        logger.success(`  ✓ ${expectedName} deletion initiated`);
      }
    }
  } catch {
    // App Runner API might not be available or no services exist — not an error
    logger.info('  No legacy App Runner services found');
  }
}
