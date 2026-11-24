/**
 * The triggers of an environment: the scheduledJobs entries that call an
 * endpoint (no `type`, or `type: "trigger"`). Cron jobs are left out; they
 * are deployed and listed by their own paths.
 */

import { isTriggerJob } from '@tsdevstack/infra-core';
import type { TriggerJobConfig } from './types';
import { getScheduledJobs } from './get-scheduled-jobs';

/**
 * @param config - Infrastructure config (or null for no jobs)
 * @param environment - Environment name
 */
export function getTriggerJobs(
  config: { [env: string]: unknown } | null,
  environment: string,
): TriggerJobConfig[] {
  return getScheduledJobs(config, environment).filter(isTriggerJob);
}
