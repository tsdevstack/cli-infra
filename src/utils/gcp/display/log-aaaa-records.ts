/**
 * Log the AAAA records for the load balancer's IPv6 address
 *
 * Printed after the A records by infra:deploy and infra:deploy-lb on GCP,
 * where the maintainer creates the records at the domain registrar.
 */

import { getContext } from '../../../context';
import { padRight } from '../../display/pad-right';

/**
 * Log one AAAA record per host, pointing to the load balancer's IPv6 address
 *
 * @param hosts - Hosts that get an A record (the API and frontend domains)
 * @param ipv6 - The load balancer's IPv6 address
 */
export function logAaaaRecords(hosts: string[], ipv6: string): void {
  const { logger } = getContext();
  if (hosts.length === 0 || !ipv6) return;

  const hostWidth = Math.max(...hosts.map((host) => host.length));
  logger.newline();
  logger.info('  AAAA Records (point to load balancer IPv6 address):');
  logger.newline();
  logger.info(`    ${padRight('Host', hostWidth)}  Value`);
  logger.info(`    ${'─'.repeat(hostWidth + 2 + ipv6.length)}`);
  for (const host of hosts) {
    logger.info(`    ${padRight(host, hostWidth)}  ${ipv6}`);
  }
}
