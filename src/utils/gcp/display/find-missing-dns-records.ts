/**
 * Find the DNS records that are not in place yet
 */

import { Resolver } from 'node:dns/promises';
import { DNS_CHECK } from '../../../constants';
import type { DnsRecord } from './types';

/**
 * Look up each record and return those that don't resolve to the expected
 * value. A lookup that fails counts as missing, so the record is shown
 * rather than hidden.
 *
 * @param records - Records with their expected values
 * @returns The records that are missing or point elsewhere
 */
export async function findMissingDnsRecords(
  records: readonly DnsRecord[],
): Promise<DnsRecord[]> {
  const resolver = new Resolver({
    timeout: DNS_CHECK.timeoutMs,
    tries: DNS_CHECK.tries,
  });
  const name = (value: string): string =>
    value.toLowerCase().replace(/\.$/, '');
  const ipv6 = (value: string): string => new URL(`http://[${value}]`).hostname;
  const canonical = (type: DnsRecord['type'], value: string): string =>
    type === 'AAAA' ? ipv6(value) : name(value);

  const results = await Promise.all(
    records.map(async (record) => {
      try {
        const host = name(record.host);
        const answers =
          record.type === 'A'
            ? await resolver.resolve4(host)
            : record.type === 'AAAA'
              ? await resolver.resolve6(host)
              : await resolver.resolveCname(host);
        const expected = canonical(record.type, record.value);
        return answers.some(
          (answer) => canonical(record.type, answer) === expected,
        )
          ? null
          : record;
      } catch {
        return record;
      }
    }),
  );
  return results.filter((record): record is DnsRecord => record !== null);
}
