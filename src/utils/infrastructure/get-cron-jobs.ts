/**
 * The cron jobs of an environment: the scheduledJobs entries with
 * `type: "cron"`, each a run of its service's image as
 * `node dist/cron.js <name>`
 */

import { isCronJob } from '@tsdevstack/infra-core';
import type { CronJobConfig } from './types';
import { getScheduledJobs } from './get-scheduled-jobs';

/**
 * @param config - Infrastructure config (or null for no jobs)
 * @param environment - Environment name
 */
export function getCronJobs(
  config: { [env: string]: unknown } | null,
  environment: string,
): CronJobConfig[] {
  return getScheduledJobs(config, environment).filter(isCronJob);
}
