/**
 * Get Scheduled Jobs Configuration
 *
 * Extracts scheduled jobs from infrastructure config for a given environment.
 */

import type { ScheduledJobConfig } from './types';

/**
 * Get scheduled jobs for an environment
 *
 * @param config - Infrastructure config (or null for no jobs)
 * @param environment - Environment name
 * @returns Array of scheduled job configurations
 */
export function getScheduledJobs(
  config: { [env: string]: unknown } | null,
  environment: string
): ScheduledJobConfig[] {
  // No config file - no jobs
  if (!config) {
    return [];
  }

  // Get environment overrides
  const envConfig = config[environment];
  if (!envConfig || typeof envConfig !== 'object') {
    return [];
  }

  // Get scheduled jobs
  const scheduledJobs = (envConfig as { scheduledJobs?: ScheduledJobConfig[] }).scheduledJobs;

  return scheduledJobs ?? [];
}