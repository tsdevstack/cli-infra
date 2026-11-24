/**
 * Build the list of log sources of an environment from the project config:
 * services, workers, frontends, Kong, migration runs, the database setup
 * job (db-init), scheduled jobs (triggers and cron jobs), the storage
 * buckets' access logs and the edge. The names are the same on every provider. SPAs log nothing of their
 * own (their requests show under edge).
 */

import type { FrameworkService } from '@tsdevstack/cli/plugin';
import { isCronJob } from '@tsdevstack/infra-core';
import {
  BUCKET_LOG_SOURCE_PREFIX,
  DB_INIT_LOG_SOURCE,
  EDGE_LOG_SOURCE,
  KONG_LOG_SOURCE,
  MIGRATION_LOG_SOURCE_PREFIX,
} from '../../constants';
import type { ScheduledJobConfig } from '../infrastructure/types';
import type { LogSource } from './types';

export function buildLogSources(
  services: FrameworkService[],
  scheduledJobs: ScheduledJobConfig[],
  storageBuckets: readonly string[] = [],
): LogSource[] {
  const sources: LogSource[] = [];

  for (const service of services) {
    if (service.type === 'nestjs') {
      sources.push({ name: service.name, type: 'service' });
    }
  }
  for (const service of services) {
    if (service.type === 'worker') {
      sources.push({ name: service.name, type: 'worker' });
    }
  }
  for (const service of services) {
    if (service.type === 'nextjs') {
      sources.push({ name: service.name, type: 'frontend' });
    }
  }

  sources.push({ name: KONG_LOG_SOURCE, type: 'kong' });

  for (const service of services) {
    if (service.hasDatabase) {
      sources.push({
        name: `${MIGRATION_LOG_SOURCE_PREFIX}${service.name}`,
        type: 'migration',
      });
    }
  }

  // The database setup job: one per environment, run by infra:deploy
  if (services.some((service) => service.hasDatabase)) {
    sources.push({ name: DB_INIT_LOG_SOURCE, type: 'db-init' });
  }

  for (const job of scheduledJobs) {
    sources.push({
      name: job.name,
      type: isCronJob(job) ? 'cron' : 'job',
      service: job.targetService,
    });
  }

  for (const bucket of storageBuckets) {
    sources.push({
      name: `${BUCKET_LOG_SOURCE_PREFIX}${bucket}`,
      type: 'bucket',
      bucket,
    });
  }

  sources.push({ name: EDGE_LOG_SOURCE, type: 'edge' });

  return sources;
}
