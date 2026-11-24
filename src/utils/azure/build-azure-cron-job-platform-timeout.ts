/**
 * A cron job's replicaTimeout on Azure: Azure's own limit on a run
 *
 * The runner (nest-common's runCronJob) stops a run at the job's timeout;
 * the platform's limit is only for a stuck process, so it must come later.
 * Azure counts replicaTimeout from the run's creation, not from its
 * container's start, and a run first waits for a node and its image: 35 to
 * 88 s on az7 (2026-11-23, a 700 MB image). With only the margin every
 * cloud gets (CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS: boot, grace, lock
 * release), Azure's limit came 8 s before the runner's forced exit there.
 * The start allowance (AZURE_JOB_START_MARGIN_SECONDS) keeps the runner
 * first.
 */

import { CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS } from '@tsdevstack/infra-core';
import { AZURE_JOB_START_MARGIN_SECONDS } from '../../constants';

/**
 * @param timeoutSeconds - The cron job's timeout
 * @returns Seconds for the Container App Job's replicaTimeout
 */
export function buildAzureCronJobPlatformTimeout(
  timeoutSeconds: number,
): number {
  return (
    timeoutSeconds +
    CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS +
    AZURE_JOB_START_MARGIN_SECONDS
  );
}
