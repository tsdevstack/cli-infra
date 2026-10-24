/**
 * Pre-flight check: verify PostgreSQL Flexible Server is available in the target region.
 *
 * Azure restricts PostgreSQL provisioning in certain regions for some subscription types
 * (free trial, student, sponsorship) and during capacity constraints. This check calls
 * the Azure REST API to detect restrictions before running a long terraform apply.
 * With database.ha it also checks that the region offers zone-redundant high
 * availability (only regions with availability zones do).
 */

import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';

interface PostgresAvailabilityResult {
  available: boolean;
  error?: string;
}

export interface PostgresAvailabilityOptions {
  /** database.ha is on: the region must offer zone-redundant high availability */
  zoneRedundantHa?: boolean;
}

interface FlexibleServerCapability {
  zoneRedundantHaSupported?: string;
  supportedFeatures?: Array<{ name?: string; status?: string }>;
}

export async function checkPostgresAvailability(
  credentials: AzureCredentials,
  options: PostgresAvailabilityOptions = {},
): Promise<PostgresAvailabilityResult> {
  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const tokenResponse = await credential.getToken(
    'https://management.azure.com/.default',
  );

  if (!tokenResponse) {
    return {
      available: false,
      error:
        'Failed to obtain Azure access token for PostgreSQL availability check',
    };
  }

  const url =
    `https://management.azure.com/subscriptions/${credentials.subscriptionId}` +
    `/providers/Microsoft.DBforPostgreSQL/locations/${credentials.location}` +
    `/capabilities?api-version=2022-12-01`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${tokenResponse.token}` },
  });

  if (!response.ok) {
    return {
      available: false,
      error: `Failed to check PostgreSQL availability: HTTP ${response.status}`,
    };
  }

  const data = (await response.json()) as { value?: unknown[] };

  if (!data.value || data.value.length === 0) {
    return {
      available: false,
      error:
        `PostgreSQL Flexible Server is not available in '${credentials.location}' ` +
        `for your subscription. This is an Azure regional restriction.\n\n` +
        `To fix: change "location" in .tsdevstack/.credentials.azure.json to a supported region.\n` +
        `Recommended alternatives: eastus2, centralus, westus2`,
    };
  }

  if (options.zoneRedundantHa) {
    // Older API versions report zoneRedundantHaSupported, newer ones a
    // ZoneRedundantHa feature; block only when the region says it is off
    const reported = (data.value as FlexibleServerCapability[])
      .flatMap((capability) => [
        capability.zoneRedundantHaSupported,
        ...(capability.supportedFeatures ?? [])
          .filter((feature) => feature.name === 'ZoneRedundantHa')
          .map((feature) => feature.status),
      ])
      .filter((status): status is string => status !== undefined);

    if (reported.length > 0 && !reported.includes('Enabled')) {
      return {
        available: false,
        error:
          `"database.ha" is on, but zone-redundant high availability is not available ` +
          `in '${credentials.location}' (the region has no availability zones for PostgreSQL).\n\n` +
          `To fix: change "location" in .tsdevstack/.credentials.azure.json to a region with ` +
          `availability zones (for example eastus2, centralus, westus2), or set "ha" to false ` +
          `in .tsdevstack/infrastructure.json.`,
      };
    }
  }

  return { available: true };
}
