/**
 * Discover Coupled Cron Jobs (GCP)
 *
 * Finds the Cloud Run Jobs deploys created for a service's cron jobs: this
 * project's cron jobs (discoverCronJobs, by label) whose service label is
 * the service's name. They run the service's image as its account, so they
 * go when the service goes, each with the Cloud Scheduler job that starts it.
 */

import type { NamingScheme } from '@tsdevstack/infra-core';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { discoverCronJobs } from './discover-cron-jobs';

export interface DiscoverCoupledCronJobsOptions {
  serviceName: string;
  projectName: string;
  /** The environment's naming scheme (the project label, the schedule's name) */
  naming: NamingScheme;
  credentials: GCPCredentials;
}

export interface CoupledCronJobInfo {
  /** The cron job's config name */
  name: string;
  /** Its Cloud Run Job (`{project}-cron-{name}`) */
  cloudRunJobName: string;
  /** Its Cloud Scheduler job (`{project}-{name}`) */
  schedulerJobName: string;
}

export async function discoverCoupledCronJobs(
  options: DiscoverCoupledCronJobsOptions,
): Promise<CoupledCronJobInfo[]> {
  const { serviceName, projectName, naming, credentials } = options;
  const jobs = await discoverCronJobs({ projectName, naming, credentials });
  return jobs
    .filter((job) => job.serviceName === serviceName)
    .map(({ name, cloudRunJobName, schedulerJobName }) => ({
      name,
      cloudRunJobName,
      schedulerJobName,
    }));
}
