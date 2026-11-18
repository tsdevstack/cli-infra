/**
 * Whether the framework (or Azure itself) made a record in the DNS zone
 *
 * The framework's records are recognized by what they are, so environments
 * deployed before this check work the same:
 * - NS and SOA at the apex: Azure creates them with the zone.
 * - TXT `_dnsauth` or `_dnsauth.<name>`: Front Door's domain validation.
 * - CNAME to `*.azurefd.net`: a subdomain pointing at a Front Door endpoint.
 * - A or AAAA alias to a Front Door endpoint (`Microsoft.Cdn/profiles`): the
 *   apex, which can't be a CNAME.
 * Everything else was added by hand (email records, verifications...).
 */

import { getDnsRecordType } from './get-dns-record-type';
import type { AzureDnsRecordSet } from './types';

const FRONT_DOOR_CNAME_SUFFIX = '.azurefd.net';
const FRONT_DOOR_RESOURCE_PATH = '/providers/microsoft.cdn/profiles/';

export function isFrameworkDnsRecord(recordSet: AzureDnsRecordSet): boolean {
  const type = getDnsRecordType(recordSet);
  const { name } = recordSet;

  if ((type === 'NS' || type === 'SOA') && name === '@') {
    return true;
  }
  if (type === 'TXT' && (name === '_dnsauth' || name.startsWith('_dnsauth.'))) {
    return true;
  }
  if (type === 'CNAME') {
    const target = (recordSet.properties?.CNAMERecord?.cname ?? '')
      .toLowerCase()
      .replace(/\.$/, '');
    return target.endsWith(FRONT_DOOR_CNAME_SUFFIX);
  }
  if (type === 'A' || type === 'AAAA') {
    const targetId = recordSet.properties?.targetResource?.id ?? '';
    return targetId.toLowerCase().includes(FRONT_DOOR_RESOURCE_PATH);
  }
  return false;
}
