/**
 * Validate a trigger's own fields: endpoint, method and httpTimeout
 *
 * Each cloud makes a trigger's HTTP call differently, and each has its own
 * limit on how long the call may wait (httpTimeout). A value outside it stops
 * here, at infra:generate, instead of failing at deploy or being cut short at
 * run.
 */

import { SCHEDULED_JOB_HTTP_TIMEOUT } from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import {
  HTTP_TIMEOUT_LIMIT_REASONS,
  VALID_SCHEDULED_JOB_METHODS,
} from '../../constants';
import type { SchemaProvider } from './get-provider-schema-config';
import { validateEnum } from './validate-enum';

/**
 * @param context - Where the entry is, for the messages (dev.scheduledJobs.cleanup)
 * @param fields - The entry's fields
 * @param provider - Cloud provider of the project
 * @throws CliError on a missing endpoint, an unknown method, or an httpTimeout
 *   outside the cloud's limits
 */
export function validateTriggerJobFields(
  context: string,
  fields: Record<string, unknown>,
  provider: SchemaProvider,
): void {
  const { CliError } = getContext();

  if (typeof fields.endpoint !== 'string' || fields.endpoint === '') {
    throw new CliError(
      `${context}.endpoint is missing`,
      'Infrastructure Config',
      'A trigger calls an endpoint of its service, e.g. "/auth/jobs/cleanup-tokens". A job that runs code instead is a cron job: "type": "cron".',
    );
  }

  if (fields.method !== undefined) {
    validateEnum(fields.method, 'method', context, VALID_SCHEDULED_JOB_METHODS);
  }

  if (fields.httpTimeout !== undefined) {
    const { min, max } = SCHEDULED_JOB_HTTP_TIMEOUT[provider];
    const timeout = fields.httpTimeout;
    if (
      typeof timeout !== 'number' ||
      !Number.isInteger(timeout) ||
      timeout < min ||
      timeout > max
    ) {
      const tooShort = typeof timeout === 'number' && timeout < min;
      throw new CliError(
        `${context}.httpTimeout: ${String(timeout)} is not a whole number of seconds from ${min} to ${max}`,
        'Infrastructure Config',
        tooShort
          ? `At least ${min} s on every cloud (Cloud Scheduler's minimum), so a job means the same everywhere.`
          : `${HTTP_TIMEOUT_LIMIT_REASONS[provider]} A job that needs longer can start the work, return, and finish it in a worker.`,
      );
    }
  }
}
