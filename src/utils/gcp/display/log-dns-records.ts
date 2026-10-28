/**
 * Print the DNS records still to add at the registrar, with what they are for
 */

import { getContext } from '../../../context';
import { padRight } from '../../display/pad-right';
import type { DnsRecord } from './types';

/**
 * Print the records grouped by type, each group as a Host / Value table,
 * then what each kind of record does. Only the explanations for the record
 * types in the list are printed.
 *
 * @param records - Records that are missing or point elsewhere
 */
export function logDnsRecords(records: readonly DnsRecord[]): void {
  const { logger } = getContext();
  if (records.length === 0) return;

  const sections: ReadonlyArray<{ type: DnsRecord['type']; title: string }> = [
    { type: 'A', title: 'A Records (point to load balancer IP):' },
    {
      type: 'AAAA',
      title: 'AAAA Records (point to load balancer IPv6 address):',
    },
    {
      type: 'CNAME',
      title:
        'SSL Certificate Validation (CNAME records, kept for certificate renewals):',
    },
  ];

  logger.info(
    'DNS records to add at your registrar (missing or pointing elsewhere):',
  );

  for (const { type, title } of sections) {
    const rows = records.filter((record) => record.type === type);
    if (rows.length === 0) continue;

    const hostWidth = Math.max(...rows.map((row) => row.host.length));
    const valueWidth = Math.max(...rows.map((row) => row.value.length));
    logger.newline();
    logger.info(`  ${title}`);
    logger.newline();
    logger.info(`    ${padRight('Host', hostWidth)}  Value`);
    logger.info(`    ${'─'.repeat(hostWidth + 2 + valueWidth)}`);
    for (const row of rows) {
      logger.info(`    ${padRight(row.host, hostWidth)}  ${row.value}`);
    }
  }

  const hasAddress = records.some((record) => record.type !== 'CNAME');
  const hasCname = records.some((record) => record.type === 'CNAME');
  logger.newline();
  if (hasAddress) {
    logger.info(
      "  A and AAAA records send each domain's visitors to the load balancer.",
    );
  }
  if (hasCname) {
    logger.info(
      '  CNAME records (_acme-challenge) let Google confirm you own the domain and issue its certificate. Keep them: renewals use them too.',
    );
    logger.info(
      "  On a first deploy the certificates are requested before these records exist, so Google's first check fails. It checks again on its own, and HTTPS works within about an hour of adding the records.",
    );
  }
  logger.info(
    '  A new app or domain adds its records to this list on the next deploy.',
  );
}
