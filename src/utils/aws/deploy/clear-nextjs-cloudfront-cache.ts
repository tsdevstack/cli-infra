/**
 * Clear a Next.js app's CloudFront cache after its deploy. Next.js marks its
 * prebuilt pages cacheable for a year (`s-maxage=31536000`), so CloudFront
 * would keep serving the old version's pages, which ask for script files the
 * new version doesn't have ("Failed to load chunk"). A failure only warns:
 * the deploy itself worked.
 */

import { invalidateCloudfront } from '@tsdevstack/infra-core';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { findServiceDistributions } from '../discovery';

export async function clearNextjsCloudfrontCache(params: {
  runtime: ReturnType<typeof buildRuntime>;
  projectName: string;
  targetEnv: string;
  serviceName: string;
  credentials: AWSCredentials;
}): Promise<void> {
  const { logger } = getContext();
  const { runtime, projectName, targetEnv, serviceName, credentials } = params;

  const found = await findServiceDistributions({
    projectName,
    targetEnv,
    serviceName,
    credentials,
  });
  if (!found.success) {
    logger.warn(
      `  ⚠ ${serviceName}: could not find its CloudFront distribution (${found.error}). Pages may show the old version until their cache expires.`,
    );
    return;
  }

  const distributions = found.distributions.filter(
    (distribution) => distribution.kind === 'nextjs',
  );
  for (const distribution of distributions) {
    try {
      const result = await invalidateCloudfront(runtime, {
        distributionId: distribution.id,
        credentials,
      });
      logger.success(
        `  ✓ ${serviceName}: CloudFront cache cleared (${result.invalidationId})`,
      );
    } catch (error) {
      logger.warn(
        `  ⚠ ${serviceName}: CloudFront cache not cleared (${error instanceof Error ? error.message : 'unknown error'}). Pages may show the old version until their cache expires.`,
      );
    }
  }
}
