/**
 * Platform lines on AWS come from ECS, not from CloudWatch Logs: each
 * service's events (deployments, steady state, tasks it could not place)
 * and its stopped tasks with their reasons and exit codes. Migrations, the
 * database setup job (db-init) and cron jobs are standalone tasks: their
 * stopped tasks only. ECS keeps the last 100 events per service and stopped tasks for
 * about an hour.
 */

import {
  DescribeServicesCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  type ECSClient,
  type Task,
} from '@aws-sdk/client-ecs';
import {
  AWS_DB_INIT_TASK_FAMILY_SUFFIX,
  AWS_ECS_SERVICE_LOG_SOURCE_TYPES,
  MIGRATION_LOG_SOURCE_PREFIX,
} from '../../../constants';
import { buildAwsMigrationNames } from '../build-aws-migration-names';
import { buildAwsCronJobNames } from '../build-aws-cron-job-names';
import type { LogEntry, LogSource } from '../../logs/types';
import { formatAwsStoppedTask } from './format-aws-stopped-task';

const ECS_SERVICE_TYPES = new Set<string>(AWS_ECS_SERVICE_LOG_SOURCE_TYPES);
/** DescribeServices takes up to 10 services, DescribeTasks up to 100 tasks */
const DESCRIBE_SERVICES_BATCH = 10;
const DESCRIBE_TASKS_BATCH = 100;

export async function listAwsEcsPlatformEntries(params: {
  ecs: ECSClient;
  projectName: string;
  clusterName: string;
  sources: LogSource[];
  since: Date;
  until: Date;
}): Promise<LogEntry[]> {
  const { ecs, projectName, clusterName, sources, since, until } = params;
  const inWindow = (date: Date | undefined): date is Date =>
    date !== undefined && date >= since && date <= until;

  const entries: LogEntry[] = [];
  const services = sources.filter((source) =>
    ECS_SERVICE_TYPES.has(source.type),
  );
  const migrations = sources.filter((source) => source.type === 'migration');
  const dbInit = sources.filter((source) => source.type === 'db-init');
  const cronJobs = sources.filter((source) => source.type === 'cron');

  // Service events
  for (let i = 0; i < services.length; i += DESCRIBE_SERVICES_BATCH) {
    const batch = services.slice(i, i + DESCRIBE_SERVICES_BATCH);
    const response = await ecs.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: batch.map((source) => source.name),
      }),
    );
    for (const service of response.services ?? []) {
      for (const event of service.events ?? []) {
        if (!inWindow(event.createdAt) || !service.serviceName) continue;
        // "(service auth-service) has reached a steady state."
        const message = (event.message ?? '').replace(
          /^\(service [^)]+\)\s*/,
          '',
        );
        entries.push({
          time: event.createdAt.toISOString(),
          source: service.serviceName,
          kind: 'platform',
          level: /unable|failed|unhealthy|error/i.test(message)
            ? 'warn'
            : 'info',
          message,
          raw: event,
        });
      }
    }
  }

  // Stopped tasks
  const stoppedTasks = async (
    source: LogSource,
    filter: { serviceName: string } | { family: string },
  ): Promise<void> => {
    const listed = await ecs.send(
      new ListTasksCommand({
        cluster: clusterName,
        desiredStatus: 'STOPPED',
        ...filter,
      }),
    );
    const arns = listed.taskArns ?? [];
    for (let i = 0; i < arns.length; i += DESCRIBE_TASKS_BATCH) {
      const described = await ecs.send(
        new DescribeTasksCommand({
          cluster: clusterName,
          tasks: arns.slice(i, i + DESCRIBE_TASKS_BATCH),
        }),
      );
      for (const task of described.tasks ?? ([] as Task[])) {
        if (!inWindow(task.stoppedAt)) continue;
        entries.push({
          time: task.stoppedAt.toISOString(),
          source: source.name,
          kind: 'platform',
          ...formatAwsStoppedTask(task),
          raw: task,
        });
      }
    }
  };

  for (const source of services) {
    await stoppedTasks(source, { serviceName: source.name });
  }
  for (const source of migrations) {
    // Both families: the old one ran until the environment migrated with
    // this CLI
    const names = buildAwsMigrationNames(
      projectName,
      source.name.slice(MIGRATION_LOG_SOURCE_PREFIX.length),
    );
    for (const family of [names.taskFamily, names.legacyTaskFamily]) {
      await stoppedTasks(source, { family });
    }
  }
  for (const source of dbInit) {
    await stoppedTasks(source, {
      family: `${projectName}${AWS_DB_INIT_TASK_FAMILY_SUFFIX}`,
    });
  }
  for (const source of cronJobs) {
    await stoppedTasks(source, {
      family: buildAwsCronJobNames(
        projectName,
        source.service ?? '',
        source.name,
      ).taskFamily,
    });
  }

  return entries.sort((a, b) =>
    a.time < b.time ? -1 : a.time > b.time ? 1 : 0,
  );
}
