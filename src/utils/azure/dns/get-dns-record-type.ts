import type { AzureDnsRecordSet } from './types';

/**
 * The record type of an Azure DNS record set: "MX" from
 * "Microsoft.Network/dnszones/MX"
 */
export function getDnsRecordType(recordSet: AzureDnsRecordSet): string {
  return recordSet.type.split('/').pop()?.toUpperCase() ?? '';
}
