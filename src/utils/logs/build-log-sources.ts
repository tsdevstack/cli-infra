/**
 * Build the list of log sources of an environment from the project config:
 * services, workers, frontends, Kong, migration runs, scheduled jobs and the
 * edge. The names are the same on every provider. SPAs are storage buckets
 * and log nothing of their own (their requests show under edge).
 */

import type { FrameworkService } from '@tsdevstack/cli/plugin';
import {
  EDGE_LOG_SOURCE,
  KONG_LOG_SOURCE,
  MIGRATION_LOG_SOURCE_PREFIX,
} from '../../constants';
import type { ScheduledJobConfig } from '../infrastructure/types';
import type { LogSource } from './types';

export function buildLogSources(
  services: FrameworkService[],
  scheduledJobs: ScheduledJobConfig[],
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

  for (const job of scheduledJobs) {
    sources.push({ name: job.name, type: 'job', service: job.targetService });
  }

  sources.push({ name: EDGE_LOG_SOURCE, type: 'edge' });

  return sources;
}
