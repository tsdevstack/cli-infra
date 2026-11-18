/**
 * Validate Scheduled Jobs
 *
 * Each cloud makes a job's HTTP call differently, and each has its own limit
 * on how long the call may wait (httpTimeout). A value outside it stops here,
 * at infra:generate, instead of failing at deploy or being cut short at run.
 */

import { SCHEDULED_JOB_HTTP_TIMEOUT } from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import {
  UTC_TIME_ZONE_NAMES,
  VALID_SCHEDULED_JOB_FIELDS,
  VALID_SCHEDULED_JOB_METHODS,
} from '../../constants';
import type { SchemaProvider } from './get-provider-schema-config';
import { validateEnum } from './validate-enum';
import { isValidTimeZone } from './is-valid-time-zone';

/** Why each cloud's httpTimeout stops where it does */
const HTTP_TIMEOUT_LIMIT_REASONS: Record<SchemaProvider, string> = {
  gcp: 'Cloud Scheduler waits at most 30 minutes for a response.',
  aws: "The job invoker Lambda stops at 900 s and needs the last 10 s to log the run's end.",
  azure:
    'Container Apps ingress ends every HTTP request at 240 s, and jobs reach their service through it.',
};

/**
 * Validate the scheduledJobs list of an environment
 *
 * @param environment - Environment name for error messages
 * @param jobs - Raw scheduledJobs value from infrastructure.json
 * @param provider - Cloud provider of the project
 * @throws CliError on an unknown field, an unknown method, an httpTimeout
 *   outside the cloud's limits, a name that isn't a time zone, or a time zone
 *   other than UTC on Azure (its jobs run their schedule in UTC only)
 */
export function validateScheduledJobs(
  environment: string,
  jobs: unknown,
  provider: SchemaProvider,
): void {
  const { CliError } = getContext();

  if (!Array.isArray(jobs)) {
    throw new CliError(
      `"scheduledJobs" must be a list (${environment}.scheduledJobs)`,
      'Infrastructure Config',
      'Example: "scheduledJobs": [{ "name": "cleanup", "schedule": "0 3 * * *", "targetService": "auth-service", "endpoint": "/jobs/cleanup" }]',
    );
  }

  const { min, max } = SCHEDULED_JOB_HTTP_TIMEOUT[provider];

  jobs.forEach((job: unknown, index) => {
    if (typeof job !== 'object' || job === null || Array.isArray(job)) {
      throw new CliError(
        `${environment}.scheduledJobs[${index}] must be an object`,
        'Infrastructure Config',
        'Each job has name, schedule, targetService and endpoint',
      );
    }

    const fields = job as Record<string, unknown>;
    const context = `${environment}.scheduledJobs.${typeof fields.name === 'string' ? fields.name : index}`;

    for (const field of Object.keys(fields)) {
      if (!(VALID_SCHEDULED_JOB_FIELDS as readonly string[]).includes(field)) {
        throw new CliError(
          `Unknown field "${field}" in ${context}`,
          'Infrastructure Config',
          `Valid fields: ${VALID_SCHEDULED_JOB_FIELDS.join(', ')}`,
        );
      }
    }

    if (fields.method !== undefined) {
      validateEnum(
        fields.method,
        'method',
        context,
        VALID_SCHEDULED_JOB_METHODS,
      );
    }

    if (fields.httpTimeout !== undefined) {
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

    if (fields.timezone !== undefined) {
      const timezone = fields.timezone;
      if (typeof timezone !== 'string' || !isValidTimeZone(timezone)) {
        throw new CliError(
          `${context}.timezone: ${JSON.stringify(timezone)} is not a time zone`,
          'Infrastructure Config',
          'Use an IANA time zone name, such as UTC, Europe/Budapest or America/New_York',
        );
      }
      if (
        provider === 'azure' &&
        !(UTC_TIME_ZONE_NAMES as readonly string[]).includes(
          timezone.toUpperCase(),
        )
      ) {
        throw new CliError(
          `${context}.timezone: "${timezone}" is not possible on Azure`,
          'Infrastructure Config',
          'Azure Container Apps jobs run their schedule in UTC only. Write the schedule in UTC and remove timezone.',
        );
      }
    }
  });
}
