/**
 * Discover Cron Jobs (GCP)
 *
 * Finds the Cloud Run Jobs deploys created for this project's cron jobs by
 * their labels, not from infrastructure.json: a job whose entry was removed
 * from the config is still found. Each carries its service
 * (GCP_CRON_JOB_SERVICE_LABEL) and its name (GCP_CRON_JOB_NAME_LABEL). In
 * the unique scheme it also carries the project (GCP_PROJECT_LABEL): another
 * project's jobs in the same GCP project are left out. A legacy
 * environment's names have no project in them, so its cron jobs are all this
 * project's.
 */

import { JobsClient } from '@google-cloud/run';
import {
  buildGcpCloudRunName,
  GCP_PROJECT_LABEL,
  type NamingScheme,
} from '@tsdevstack/infra-core';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import {
  GCP_CRON_JOB_NAME_LABEL,
  GCP_CRON_JOB_SERVICE_LABEL,
} from '../../../constants';

export interface DiscoverCronJobsOptions {
  projectName: string;
  /** The environment's naming scheme (the project label, the schedule's name) */
  naming: NamingScheme;
  credentials: GCPCredentials;
}

export interface GcpCronJobInfo {
  /** The cron job's config name */
  name: string;
  /** The service whose image it runs */
  serviceName: string;
  /** Its Cloud Run Job (`{project}-cron-{name}`) */
  cloudRunJobName: string;
  /** Its Cloud Scheduler job (`{project}-{name}`) */
  schedulerJobName: string;
}

/**
 * List this project's cron jobs in the environment's region
 *
 * @throws The API's error when the jobs can't be listed
 */
export async function discoverCronJobs(
  options: DiscoverCronJobsOptions,
): Promise<GcpCronJobInfo[]> {
  const { buildGCPClientOptions } = getContext();
  const { projectName, naming, credentials } = options;
  const client = new JobsClient(buildGCPClientOptions(credentials));
  const parent = `projects/${credentials.project_id}/locations/${credentials.region}`;

  const [jobs] = await client.listJobs({ parent });
  const found: GcpCronJobInfo[] = [];
  for (const job of jobs) {
    const labels = job.labels ?? {};
    const cloudRunJobName = job.name?.split('/').pop();
    const serviceName = labels[GCP_CRON_JOB_SERVICE_LABEL];
    if (!cloudRunJobName || !serviceName) {
      continue;
    }
    if (naming === 'unique' && labels[GCP_PROJECT_LABEL] !== projectName) {
      continue;
    }
    const name = labels[GCP_CRON_JOB_NAME_LABEL] ?? cloudRunJobName;
    found.push({
      name,
      serviceName,
      cloudRunJobName,
      schedulerJobName: buildGcpCloudRunName(projectName, name, naming),
    });
  }
  return found;
}
