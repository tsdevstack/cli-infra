/**
 * Lock down public network access on App Services after Private Link is operational
 *
 * Handles the full Private Link lifecycle after terraform apply:
 * 1. Polls App Service PE connections directly (the reliable source of truth)
 * 2. When PE status = "Pending": approves PE connections via REST API
 * 3. When PE status = "Approved" for all App Services: disables public network access
 *
 * Why App Service PE connections instead of Front Door origin sharedPrivateLinkResource.status?
 * The FD origin status field is unreliable — it can remain null indefinitely even when
 * PE connections are fully operational on the App Service side. The App Service PE list
 * is the actual source of truth for whether Private Link is working.
 *
 * Setting public_network_access_enabled = false in Terraform causes downtime because
 * it takes effect immediately while Private Link needs time to propagate.
 *
 * Kong's own private endpoint (the Next.js servers' path to Kong,
 * AZURE_KONG_PRIVATE_ENDPOINT) is approved as soon as it exists, so it is
 * left out: only Front Door's connections show that Front Door can reach
 * the app once public access is off.
 */

import { getContext } from '../../../context';
import {
  AZURE_KONG_PRIVATE_ENDPOINT,
  createAzureCredential,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 40; // 10 minutes

const APP_SERVICE_API_VERSION = '2024-04-01';

interface LockDownPublicAccessParams {
  credentials: AzureCredentials;
  projectName: string;
  targetEnv: string;
  appServiceNames: string[];
  resourceGroupName: string;
}

interface PeConnection {
  name?: string;
  properties?: {
    privateEndpoint?: { id?: string };
    privateLinkServiceConnectionState?: { status?: string };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check PE connections on an App Service and approve any pending ones.
 * Returns 'approved' if at least one Approved PE exists (or was just approved),
 * 'pending' if PEs exist but none are Approved yet,
 * 'none' if no PE connections exist yet. Connections of ownEndpointId (lower
 * case) don't count and are never approved here.
 */
async function checkAndApprovePeConnections(
  token: string,
  subscriptionId: string,
  resourceGroupName: string,
  appName: string,
  ownEndpointId: string,
): Promise<'approved' | 'pending' | 'none'> {
  const { logger } = getContext();
  const peBaseUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/sites/${appName}/privateEndpointConnections`;

  const listResponse = await fetch(
    `${peBaseUrl}?api-version=${APP_SERVICE_API_VERSION}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!listResponse.ok) {
    logger.info(
      `    Failed to list PE connections on ${appName} (${listResponse.status})`,
    );
    return 'none';
  }

  const data = (await listResponse.json()) as {
    value?: PeConnection[];
  };

  const connections = (data.value ?? []).filter(
    (conn) =>
      conn.properties?.privateEndpoint?.id?.toLowerCase() !== ownEndpointId,
  );

  if (connections.length === 0) {
    return 'none';
  }

  let hasApproved = false;

  for (const conn of connections) {
    const connStatus =
      conn.properties?.privateLinkServiceConnectionState?.status;

    if (connStatus === 'Approved') {
      hasApproved = true;
    } else if (connStatus === 'Pending' && conn.name) {
      const approveResponse = await fetch(
        `${peBaseUrl}/${conn.name}?api-version=${APP_SERVICE_API_VERSION}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              privateLinkServiceConnectionState: {
                status: 'Approved',
                description: 'Approved by tsdevstack CLI',
              },
            },
          }),
        },
      );

      if (approveResponse.ok) {
        logger.success(`    Approved PE connection ${conn.name} on ${appName}`);
        hasApproved = true;
      } else {
        logger.warn(
          `    Failed to approve PE ${conn.name} on ${appName} (${approveResponse.status})`,
        );
      }
    }
  }

  return hasApproved ? 'approved' : 'pending';
}

export async function lockDownPublicAccess(
  params: LockDownPublicAccessParams,
): Promise<void> {
  const { logger } = getContext();
  const { credentials, appServiceNames, resourceGroupName } = params;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);
  const tokenResponse = await credential.getToken(
    'https://management.azure.com/.default',
  );

  if (!tokenResponse) {
    logger.warn(
      '  Failed to acquire Azure management token — skipping public access lockdown',
    );
    return;
  }

  const token = tokenResponse.token;

  // Kong's endpoint for the Next.js servers (same resource group)
  const ownEndpointId =
    `/subscriptions/${credentials.subscriptionId}/resourceGroups/${resourceGroupName}` +
    `/providers/Microsoft.Network/privateEndpoints/` +
    `${params.projectName}-${params.targetEnv}${AZURE_KONG_PRIVATE_ENDPOINT.nameSuffix}`;

  // Phase 1: Poll App Service PE connections until all have an Approved PE
  logger.info('Waiting for Private Link connections to become operational...');

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    let allApproved = true;

    for (const appName of appServiceNames) {
      try {
        const result = await checkAndApprovePeConnections(
          token,
          credentials.subscriptionId,
          resourceGroupName,
          appName,
          ownEndpointId.toLowerCase(),
        );

        if (result === 'approved') {
          // PE is operational — no log needed on every poll
        } else if (result === 'pending') {
          logger.info(
            `  [${attempt}/${MAX_POLL_ATTEMPTS}] ${appName}: PE connection pending`,
          );
          allApproved = false;
        } else {
          logger.info(
            `  [${attempt}/${MAX_POLL_ATTEMPTS}] ${appName}: No PE connections yet`,
          );
          allApproved = false;
        }
      } catch {
        logger.info(
          `  [${attempt}/${MAX_POLL_ATTEMPTS}] Failed to check ${appName}, retrying...`,
        );
        allApproved = false;
      }
    }

    if (allApproved) {
      logger.success('  All Private Link connections are operational');
      break;
    }

    if (attempt === MAX_POLL_ATTEMPTS) {
      logger.warn('  Private Link status check timed out after 10 minutes.');
      logger.warn(
        '  Skipping public access lockdown — you can re-run infra:deploy to retry.',
      );
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Phase 2: Disable public network access on each App Service
  logger.info('Locking down public network access on App Services...');

  for (const appName of appServiceNames) {
    const appUrl = `https://management.azure.com/subscriptions/${credentials.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/sites/${appName}?api-version=${APP_SERVICE_API_VERSION}`;

    try {
      const response = await fetch(appUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            publicNetworkAccess: 'Disabled',
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.warn(
          `  Failed to disable public access on ${appName}: ${response.status} — ${errorBody}`,
        );
        continue;
      }

      logger.success(`  Public access disabled on ${appName}`);
    } catch (err: unknown) {
      const error = err as { message?: string };
      logger.warn(
        `  Failed to disable public access on ${appName}: ${error.message ?? 'unknown error'}`,
      );
    }
  }

  logger.success('  Public network access lockdown complete');
}
