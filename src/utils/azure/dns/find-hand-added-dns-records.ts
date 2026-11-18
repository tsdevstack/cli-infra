/**
 * Find the records in an environment's DNS zone that the framework didn't
 * make, so infra:destroy can say what goes with the zone (email records,
 * domain verifications...) before it asks to go ahead.
 *
 * The zone is the one Terraform made: in the environment's resource group,
 * tagged ManagedBy tsdevstack with the project and environment. Found by its
 * tags, so destroy doesn't need the DOMAIN secret.
 */

import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';
import { AZURE_DNS_API_VERSION } from '../../../constants';
import { fetchArmList } from '../fetch-arm-list';
import { isFrameworkDnsRecord } from './is-framework-dns-record';
import { formatDnsRecordValues } from './format-dns-record-values';
import { getDnsRecordType } from './get-dns-record-type';
import type { AzureDnsRecordSet, HandAddedDnsRecords } from './types';

export interface FindHandAddedDnsRecordsOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  projectName: string;
  environment: string;
}

interface AzureDnsZone {
  name: string;
  tags?: Record<string, string>;
}

export async function findHandAddedDnsRecords(
  options: FindHandAddedDnsRecordsOptions,
): Promise<HandAddedDnsRecords[]> {
  const { credentials, resourceGroupName, projectName, environment } = options;
  const credential = createAzureCredential(buildRuntime(), credentials);
  const tokenResponse = await credential.getToken(
    'https://management.azure.com/.default',
  );
  if (!tokenResponse) {
    throw new Error('Could not get an Azure access token');
  }

  const zonesUrl =
    `https://management.azure.com/subscriptions/${credentials.subscriptionId}` +
    `/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/dnsZones`;
  const zones = (
    await fetchArmList<AzureDnsZone>(
      `${zonesUrl}?api-version=${AZURE_DNS_API_VERSION}`,
      tokenResponse.token,
    )
  ).filter(
    (zone) =>
      zone.tags?.ManagedBy === 'tsdevstack' &&
      zone.tags?.Project === projectName &&
      zone.tags?.Environment === environment,
  );

  const result: HandAddedDnsRecords[] = [];
  for (const zone of zones) {
    const recordSets = await fetchArmList<AzureDnsRecordSet>(
      `${zonesUrl}/${zone.name}/recordsets?api-version=${AZURE_DNS_API_VERSION}`,
      tokenResponse.token,
    );
    result.push({
      zone: zone.name,
      records: recordSets
        .filter((recordSet) => !isFrameworkDnsRecord(recordSet))
        .map((recordSet) => ({
          name: recordSet.name,
          type: getDnsRecordType(recordSet),
          values: formatDnsRecordValues(recordSet),
        })),
    });
  }

  return result;
}
