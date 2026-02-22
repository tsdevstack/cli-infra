/**
 * Upgrade Front Door SKU (Standard → Premium)
 *
 * Azure supports in-place upgrade from Standard to Premium via a dedicated
 * REST API — no downtime, no recreation. Terraform treats sku_name as ForceNew
 * (destroy+recreate), which times out for Front Door with custom domains.
 *
 * This function runs BEFORE terraform apply to upgrade the profile in-place,
 * so Terraform sees the resource is already Premium and just updates config.
 *
 * Downgrade (Premium → Standard) is NOT supported by Azure.
 */

import { getContext } from '../../../context';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 40; // 10 minutes

const API_VERSION = '2024-02-01';

interface UpgradeFrontdoorSkuParams {
  credentials: AzureCredentials;
  projectName: string;
  targetEnv: string;
  frontdoorPremium: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function upgradeFrontdoorSku(
  params: UpgradeFrontdoorSkuParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { credentials, projectName, targetEnv, frontdoorPremium } = params;

  const profileName = `${projectName}-${targetEnv}-frontdoor`;
  const resourceGroupName = `${projectName}-${targetEnv}-rg`;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);
  const tokenResponse = await credential.getToken(
    'https://management.azure.com/.default',
  );

  if (!tokenResponse) {
    throw new CliError(
      'Failed to acquire Azure management token',
      'infra:deploy',
      'Check your Azure credentials',
    );
  }

  const token = tokenResponse.token;

  const baseUrl = `https://management.azure.com/subscriptions/${credentials.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Cdn/profiles/${profileName}`;

  // Step 1: Get current profile SKU
  const getResponse = await fetch(`${baseUrl}?api-version=${API_VERSION}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (getResponse.status === 404) {
    // Profile doesn't exist yet (fresh deploy) — Terraform will create it
    return;
  }

  if (!getResponse.ok) {
    const errorBody = await getResponse.text();
    throw new CliError(
      `Failed to check Front Door profile SKU: ${getResponse.status}`,
      'infra:deploy',
      errorBody,
    );
  }

  const profile = (await getResponse.json()) as {
    sku?: { name?: string };
  };
  const currentSku = profile.sku?.name ?? '';
  const desiredSku = frontdoorPremium
    ? 'Premium_AzureFrontDoor'
    : 'Standard_AzureFrontDoor';

  // Step 2: Compare SKUs
  if (currentSku === desiredSku) {
    return; // Already correct
  }

  if (
    currentSku === 'Premium_AzureFrontDoor' &&
    desiredSku === 'Standard_AzureFrontDoor'
  ) {
    throw new CliError(
      'Azure does not support downgrading Front Door from Premium to Standard',
      'infra:deploy',
      'Remove frontdoorPremium from infrastructure.json or recreate the environment',
    );
  }

  // Step 3: Upgrade Standard → Premium
  logger.info('Upgrading Front Door from Standard to Premium...');

  const securityPolicyName = `${projectName}-${targetEnv}-security`;
  const wafPolicyName = `${projectName.replace(/-/g, '')}${targetEnv}waf`;
  const wafPolicyId = `/subscriptions/${credentials.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/${wafPolicyName}`;

  const upgradeResponse = await fetch(
    `${baseUrl}/upgrade?api-version=${API_VERSION}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        wafMappingList: [
          {
            securityPolicyName,
            changeToWafPolicy: { id: wafPolicyId },
          },
        ],
      }),
    },
  );

  if (upgradeResponse.status === 200) {
    logger.success('Front Door upgraded to Premium');
    return;
  }

  if (upgradeResponse.status !== 202) {
    const errorBody = await upgradeResponse.text();
    throw new CliError(
      `Failed to upgrade Front Door to Premium: ${upgradeResponse.status}`,
      'infra:deploy',
      errorBody,
    );
  }

  // Step 4: Poll LRO until completion
  const asyncOpUrl =
    upgradeResponse.headers.get('Azure-AsyncOperation') ??
    upgradeResponse.headers.get('Location');

  if (!asyncOpUrl) {
    // No polling URL — assume upgrade was accepted and will complete
    logger.info(
      '  Upgrade accepted (no polling URL). Waiting 60s for Azure to process...',
    );
    await sleep(60_000);
    logger.success('Front Door upgrade to Premium initiated');
    return;
  }

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(asyncOpUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!pollResponse.ok) {
      logger.warn(
        `  Poll attempt ${attempt}/${MAX_POLL_ATTEMPTS} failed (${pollResponse.status}), retrying...`,
      );
      continue;
    }

    const pollResult = (await pollResponse.json()) as {
      status?: string;
      error?: { message?: string };
    };
    const status = pollResult.status;

    if (status === 'Succeeded') {
      logger.success('Front Door upgraded to Premium');
      return;
    }

    if (status === 'Failed' || status === 'Canceled') {
      throw new CliError(
        `Front Door upgrade ${status?.toLowerCase() ?? 'failed'}`,
        'infra:deploy',
        pollResult.error?.message ??
          'Check Azure Portal for Front Door profile status',
      );
    }

    logger.info(
      `  Upgrade in progress (attempt ${attempt}/${MAX_POLL_ATTEMPTS})...`,
    );
  }

  throw new CliError(
    'Front Door upgrade timed out after 10 minutes',
    'infra:deploy',
    'The upgrade may still be in progress. Check Azure Portal and re-run infra:deploy.',
  );
}
