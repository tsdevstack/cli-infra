/**
 * The newest execution of a Container Apps job (Azure)
 */

import type { ContainerAppsAPIClient } from '@azure/arm-appcontainers';

export interface JobExecutionSummary {
  name?: string;
  status?: string;
  startTime?: Date;
}

/**
 * @param client - Container Apps client
 * @param resourceGroupName - The job's resource group
 * @param jobName - The job
 * @returns The execution that started last, or undefined when it has none
 */
export async function findLatestJobExecution(
  client: ContainerAppsAPIClient,
  resourceGroupName: string,
  jobName: string,
): Promise<JobExecutionSummary | undefined> {
  let latest: JobExecutionSummary | undefined;
  for await (const execution of client.jobsExecutions.list(
    resourceGroupName,
    jobName,
  )) {
    if (
      !latest ||
      (execution.startTime &&
        latest.startTime &&
        execution.startTime > latest.startTime)
    ) {
      latest = execution;
    }
  }
  return latest;
}
