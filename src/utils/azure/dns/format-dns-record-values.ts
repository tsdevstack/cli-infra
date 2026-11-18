/**
 * A record set's values as people write them, shortened for a terminal line
 */

import { DNS_RECORD_VALUE_DISPLAY_LENGTH } from '../../../constants';
import type { AzureDnsRecordSet } from './types';

export function formatDnsRecordValues(recordSet: AzureDnsRecordSet): string[] {
  const shorten = (value: string): string =>
    value.length > DNS_RECORD_VALUE_DISPLAY_LENGTH
      ? `${value.slice(0, DNS_RECORD_VALUE_DISPLAY_LENGTH)}...`
      : value;
  const p = recordSet.properties ?? {};
  const values = [
    ...(p.ARecords ?? []).map((r) => r.ipv4Address ?? ''),
    ...(p.AAAARecords ?? []).map((r) => r.ipv6Address ?? ''),
    ...(p.CNAMERecord?.cname ? [p.CNAMERecord.cname] : []),
    ...(p.MXRecords ?? []).map(
      (r) => `${r.preference ?? ''} ${r.exchange ?? ''}`,
    ),
    ...(p.TXTRecords ?? []).map((r) => (r.value ?? []).join('')),
    ...(p.NSRecords ?? []).map((r) => r.nsdname ?? ''),
    ...(p.CAARecords ?? []).map(
      (r) => `${r.flags ?? 0} ${r.tag ?? ''} "${r.value ?? ''}"`,
    ),
    ...(p.SRVRecords ?? []).map(
      (r) =>
        `${r.priority ?? ''} ${r.weight ?? ''} ${r.port ?? ''} ${r.target ?? ''}`,
    ),
    ...(p.PTRRecords ?? []).map((r) => r.ptrdname ?? ''),
    ...(p.targetResource?.id ? [`alias to ${p.targetResource.id}`] : []),
  ];
  return values.map(shorten);
}
