/**
 * Warn when an auth-template project has no API key usage sync job
 */

import { getContext } from '../../context';
import type { FrameworkConfig } from '@tsdevstack/cli/plugin';
import {
  API_KEY_USAGE_SYNC_JOB_NAME,
  API_KEY_USAGE_SYNC_JOB_PATH,
  API_KEY_USAGE_SYNC_JOB_SCHEDULE,
} from '../../constants';
import { getScheduledJobs } from './get-scheduled-jobs';
import type { InfrastructureConfig } from './types';

export interface WarnMissingApiKeyUsageJobOptions {
  frameworkConfig: FrameworkConfig;
  /** infrastructure.json (null when the file does not exist) */
  infraConfig: InfrastructureConfig | null;
  environment: string;
}

/**
 * The auth template's `POST /{prefix}/jobs/sync-api-key-usage` copies API key
 * week and month usage from Redis to Postgres and rebuilds the Redis key
 * index when Redis lost it. Without a scheduled job in the environment,
 * usage totals are never saved and a wiped index is only rebuilt when the
 * auth-service restarts or reconnects to Redis.
 *
 * Warns (with the entry to add) when the project uses the auth template and
 * the environment's `scheduledJobs` has no job calling that endpoint on the
 * auth-service. Projects without the auth template are not checked.
 *
 * @returns true when the warning was printed
 */
export function warnMissingApiKeyUsageJob(
  options: WarnMissingApiKeyUsageJobOptions,
): boolean {
  const { logger, hasAuthTemplate, resolveGlobalPrefix } = getContext();
  const { frameworkConfig, infraConfig, environment } = options;

  if (!hasAuthTemplate(frameworkConfig)) return false;

  const authService = frameworkConfig.services.find(
    (service) => service.name === 'auth-service',
  );
  if (!authService) return false;

  const endpoint = `/${resolveGlobalPrefix(authService)}${API_KEY_USAGE_SYNC_JOB_PATH}`;
  const jobs = getScheduledJobs(
    infraConfig as { [env: string]: unknown } | null,
    environment,
  );
  const present = jobs.some(
    (job) =>
      job.targetService === authService.name &&
      job.endpoint.replace(/\/+$/, '') === endpoint,
  );
  if (present) return false;

  const suggested = {
    name: API_KEY_USAGE_SYNC_JOB_NAME,
    schedule: API_KEY_USAGE_SYNC_JOB_SCHEDULE,
    targetService: authService.name,
    endpoint,
    method: 'POST',
  };

  logger.warn(
    `No scheduled job calls ${endpoint} on ${authService.name} in "${environment}": API key usage totals are not saved to Postgres, and a lost Redis key index is only rebuilt when the auth-service restarts.`,
  );
  logger.warn(
    `   Add to "${environment}.scheduledJobs" in .tsdevstack/infrastructure.json, then run infra:deploy-schedulers:`,
  );
  logger.warn(`   ${JSON.stringify(suggested)}`);

  return true;
}
