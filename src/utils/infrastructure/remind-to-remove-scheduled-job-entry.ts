/**
 * After infra:remove-scheduler: name the job's entry if it is still in
 * infrastructure.json (the next deploy would create the job again), and
 * stay quiet when the entry is already gone
 */

import type { ScheduledJobConfig } from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import { getScheduledJobs } from './get-scheduled-jobs';
import { loadInfrastructureConfig } from './load-infrastructure-config';

/**
 * @param targetEnv - The environment the job was removed from
 * @param isRemovedJob - Whether an entry is the removed job (each cloud
 *   knows how its resource names map to an entry)
 */
export function remindToRemoveScheduledJobEntry(
  targetEnv: string,
  isRemovedJob: (entry: ScheduledJobConfig) => boolean,
): void {
  const { logger } = getContext();

  const entry = getScheduledJobs(loadInfrastructureConfig(), targetEnv).find(
    isRemovedJob,
  );
  if (!entry) {
    return;
  }

  logger.warn(
    `"${entry.name}" is still in ${targetEnv}.scheduledJobs in .tsdevstack/infrastructure.json: remove it there too, or the next deploy creates it again`,
  );
  logger.newline();
}
