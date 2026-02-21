/**
 * Deploy SPA Services to S3
 *
 * Deploys all SPA services to S3 + CloudFront.
 */

import { getContext } from '../../../context';
import { deploySpaAws } from '../deploy/deploy-spa-aws';
import { parseServiceFilter } from '@tsdevstack/infra-core';
import type { AWSCommandContext } from './types';

export interface DeploySpaServicesOptions {
  /** Specific service to deploy (optional, deploys all SPAs if not specified) */
  service?: string;
}

/**
 * Deploy SPA services to S3
 */
export async function deploySpaServices(
  ctx: AWSCommandContext,
  options: DeploySpaServicesOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig } = getContext();

  const config = loadFrameworkConfig();
  const { projectRoot, targetEnv, credentials } = ctx;

  // Get SPA services
  let spaServices = config.services.filter((s) => s.type === 'spa');

  // Filter by specific service(s) if provided
  const serviceFilter = parseServiceFilter(options.service);
  if (serviceFilter) {
    spaServices = spaServices.filter((s) => serviceFilter.includes(s.name));
  }

  if (spaServices.length === 0) {
    logger.info('No SPA services to deploy');
    return;
  }

  logger.info(`SPA services: ${spaServices.map((s) => s.name).join(', ')}`);
  logger.newline();

  for (const service of spaServices) {
    await deploySpaAws({
      projectRoot,
      targetEnv,
      credentials,
      service,
    });
  }

  logger.complete(
    `${spaServices.length} SPA service(s) deployed successfully!`,
  );
  logger.newline();
}
