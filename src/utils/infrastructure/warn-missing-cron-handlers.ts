/**
 * Warn when a cron job entry has no code behind it
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  APPS_DIR,
  CRON_ENTRY_FILE,
  CRON_HANDLER_DIR,
  CRON_HANDLER_SUFFIX,
} from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import { getCronJobs } from './get-cron-jobs';
import type { InfrastructureConfig } from './types';

export interface WarnMissingCronHandlersOptions {
  /** infrastructure.json (null when the file does not exist) */
  infraConfig: InfrastructureConfig | null;
  environment: string;
  projectRoot: string;
}

/**
 * A cron job runs `node dist/cron.js <name>` in its service's image, so the
 * service needs src/cron.ts and a handler src/cron/{name}.cron.ts, both
 * written by `register-cron`. An entry without them deploys fine and fails
 * at its first run: without src/cron.ts the image has no dist/cron.js and
 * Node exits 1 ("Cannot find module"); with it but without the handler, the
 * runner exits 2 ("unknown cron job"). Warns at infra:generate, with the
 * command that creates the files.
 *
 * @returns the names of the cron jobs warned about
 */
export function warnMissingCronHandlers(
  options: WarnMissingCronHandlersOptions,
): string[] {
  const { logger } = getContext();
  const { infraConfig, environment, projectRoot } = options;

  const missing: string[] = [];
  for (const job of getCronJobs(
    infraConfig as { [env: string]: unknown } | null,
    environment,
  )) {
    const serviceDir = path.join(projectRoot, APPS_DIR, job.targetService);
    const handlerFile = `${CRON_HANDLER_DIR}/${job.name}${CRON_HANDLER_SUFFIX}`;
    const absent = [CRON_ENTRY_FILE, handlerFile].filter(
      (file) => !fs.existsSync(path.join(serviceDir, file)),
    );
    if (absent.length === 0) continue;

    missing.push(job.name);
    logger.warn(
      `Cron job "${job.name}" (${environment}) has no code in ${APPS_DIR}/${job.targetService}: missing ${absent.join(' and ')}. A run would fail at start.`,
    );
    logger.warn(
      `   Create it: npx tsdevstack register-cron --service ${job.targetService} --name ${job.name}`,
    );
  }
  return missing;
}
