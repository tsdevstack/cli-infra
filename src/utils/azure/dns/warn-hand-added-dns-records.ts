/**
 * Before infra:destroy deletes the environment's DNS zone, list the records
 * in it that the framework didn't make (Resend's email records, domain
 * verifications...): they go with the zone. Listing never blocks a teardown:
 * if it fails, a warning says so.
 */

import { getContext } from '../../../context';
import { findHandAddedDnsRecords } from './find-hand-added-dns-records';
import type { FindHandAddedDnsRecordsOptions } from './find-hand-added-dns-records';

export async function warnHandAddedDnsRecords(
  options: FindHandAddedDnsRecordsOptions,
): Promise<void> {
  const { logger } = getContext();

  let zones;
  try {
    zones = await findHandAddedDnsRecords(options);
  } catch (error) {
    logger.warn(
      `Could not list the records of the DNS zone (${error instanceof Error ? error.message : String(error)}). The zone is deleted with every record in it.`,
    );
    logger.newline();
    return;
  }

  for (const { zone, records } of zones) {
    if (records.length === 0) continue;

    logger.warn(
      `The DNS zone ${zone} is deleted with the environment, with ${records.length} record${records.length === 1 ? '' : 's'} the framework didn't make:`,
    );
    const nameWidth = Math.max(...records.map((r) => r.name.length));
    const typeWidth = Math.max(...records.map((r) => r.type.length));
    for (const record of records) {
      for (const value of record.values) {
        logger.info(
          `  ${record.type.padEnd(typeWidth)}  ${record.name.padEnd(nameWidth)}  ${value}`,
        );
      }
    }
    logger.info(
      `  To keep a copy: az network dns zone export --resource-group ${options.resourceGroupName} --name ${zone} --file-name ${zone}.txt`,
    );
    logger.info(
      '  A later deploy creates a new zone, maybe on other name servers: check them at your registrar.',
    );
    logger.newline();
  }
}
