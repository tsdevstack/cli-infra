/**
 * Approve Private Endpoint connections on App Services
 *
 * When Front Door Premium creates Private Link origins, the PE connections
 * arrive as "Pending" and must be explicitly approved. After terraform apply,
 * PE connections may take several minutes to appear — this function polls
 * every 15s for up to 10 minutes until they show up or a timeout is reached.
 */

import { WebSiteManagementClient } from '@azure/arm-appservice';
import { getContext } from '../../../context';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 40; // 10 minutes

interface ApprovePrivateEndpointsParams {
  credentials: AzureCredentials;
  resourceGroupName: string;
  appServiceNames: string[];
  expectedCount: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function approvePrivateEndpoints(
  params: ApprovePrivateEndpointsParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { credentials, resourceGroupName, appServiceNames, expectedCount } =
    params;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);
  const client = new WebSiteManagementClient(
    credential,
    credentials.subscriptionId,
  );

  let approvedCount = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    for (const appName of appServiceNames) {
      try {
        for await (const connection of client.webApps.listPrivateEndpointConnectionList(
          resourceGroupName,
          appName,
        )) {
          const status = connection.privateLinkServiceConnectionState?.status;

          if (status === 'Pending' && connection.name) {
            logger.info(
              `  Approving PE connection "${connection.name}" on ${appName}...`,
            );

            const progressInterval = setInterval(() => {
              logger.info(`  Still waiting for approval on ${appName}...`);
            }, POLL_INTERVAL_MS);

            try {
              await client.webApps.beginApproveOrRejectPrivateEndpointConnectionAndWait(
                resourceGroupName,
                appName,
                connection.name,
                {
                  privateLinkServiceConnectionState: {
                    status: 'Approved',
                    description: 'Approved by tsdevstack CLI',
                  },
                },
              );
            } finally {
              clearInterval(progressInterval);
            }

            approvedCount++;
            logger.success(
              `  Approved PE connection "${connection.name}" on ${appName}`,
            );
          }
        }
      } catch (err: unknown) {
        const error = err as { message?: string };
        throw new CliError(
          `Failed to approve Private Endpoint connections on "${appName}"`,
          'infra:deploy',
          error.message ?? 'Check Azure Portal for PE connection status',
        );
      }
    }

    if (approvedCount >= expectedCount) {
      break;
    }

    if (attempt < MAX_ATTEMPTS) {
      logger.info(
        `  Waiting for PE connections to appear (attempt ${attempt}/${MAX_ATTEMPTS})...`,
      );
      await sleep(POLL_INTERVAL_MS);
    }
  }

  if (approvedCount === 0) {
    logger.warn(
      '  No pending Private Endpoint connections found after polling. ' +
        'Check Azure Portal or re-run infra:deploy to approve them.',
    );
  } else if (approvedCount < expectedCount) {
    logger.warn(
      `  ${approvedCount}/${expectedCount} PE connections approved. ` +
        'Remaining connections may need manual approval in Azure Portal.',
    );
  } else {
    logger.success(
      `  ${approvedCount} Private Endpoint connection(s) approved`,
    );
  }
}
