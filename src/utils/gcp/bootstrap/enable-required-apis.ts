/**
 * Enable Required GCP APIs
 *
 * Enables all APIs required for the framework to function.
 * Part of the bootstrap process - run once per project.
 */

import { ServiceUsageClient } from '@google-cloud/service-usage';
import { getContext } from '../../../context';
import { GCP_REQUIRED_APIS } from '../../../constants';
import type { GCPCommandContext } from '../commands/types';

/**
 * Enable all required GCP APIs for the framework
 */
export async function enableRequiredApis(
  ctx: GCPCommandContext,
): Promise<void> {
  const { logger, buildGCPClientOptions } = getContext();
  const { credentials } = ctx;

  const client = new ServiceUsageClient(buildGCPClientOptions(credentials));

  for (const api of GCP_REQUIRED_APIS) {
    const serviceName = `projects/${credentials.project_id}/services/${api}`;

    try {
      const [service] = await client.getService({ name: serviceName });
      if (service.state === 'ENABLED') {
        logger.info(`  ✓ ${api} (already enabled)`);
        continue;
      }
    } catch {
      // Service not found or error checking, proceed to enable
    }

    logger.info(`  + Enabling ${api}...`);
    const [operation] = await client.enableService({ name: serviceName });
    await operation.promise();
    logger.info(`  ✓ ${api}`);
  }
}
