/**
 * Validate Scheduled Jobs
 *
 * An environment's scheduledJobs holds two kinds: triggers (an endpoint the
 * schedule calls; no `type`, or "trigger") and cron jobs (`type: "cron"`; a
 * run of the service's image). Each kind has its own fields, and each cloud
 * its own limits: a value outside them stops here, at infra:generate,
 * instead of failing at deploy or being cut short at run. Names are unique
 * across the list, both kinds: they name the cloud schedules and job
 * resources, and a trigger named `cron-<x>` next to a cron job `<x>` would
 * share one (`{project}-cron-<x>`).
 */

import {
  CRON_JOB_NAME_PREFIX,
  CRON_JOB_TYPE,
  SCHEDULED_JOB_TYPES,
} from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import {
  UTC_TIME_ZONE_NAMES,
  VALID_CRON_JOB_FIELDS,
  VALID_TRIGGER_JOB_FIELDS,
} from '../../constants';
import type { SchemaProvider } from './get-provider-schema-config';
import { validateEnum } from './validate-enum';
import { isValidTimeZone } from './is-valid-time-zone';
import { validateTriggerJobFields } from './validate-trigger-job-fields';
import { validateCronJobFields } from './validate-cron-job-fields';

const REQUIRED_FIELDS = ['name', 'schedule', 'targetService'] as const;

/**
 * Validate the scheduledJobs list of an environment
 *
 * @param environment - Environment name for error messages
 * @param jobs - Raw scheduledJobs value from infrastructure.json
 * @param provider - Cloud provider of the project
 * @param serviceTypes - The project's services and their types (config.json);
 *   when given, every targetService must be one of them and a cron job's a
 *   NestJS service
 * @throws CliError on a missing required field, a repeated name, an unknown
 *   type or field (a field of the other kind says so), a targetService that
 *   isn't a service, a trigger's or cron job's own limits (see the two field
 *   validators), a name that isn't a time zone, or a time zone other than UTC
 *   on Azure (its jobs run their schedule in UTC only)
 */
export function validateScheduledJobs(
  environment: string,
  jobs: unknown,
  provider: SchemaProvider,
  serviceTypes?: ReadonlyMap<string, string>,
): void {
  const { CliError } = getContext();

  if (!Array.isArray(jobs)) {
    throw new CliError(
      `"scheduledJobs" must be a list (${environment}.scheduledJobs)`,
      'Infrastructure Config',
      'Example: "scheduledJobs": [{ "name": "cleanup", "schedule": "0 3 * * *", "targetService": "auth-service", "endpoint": "/jobs/cleanup" }]',
    );
  }

  const seen = new Set<string>();
  const cronNames = new Set<string>();
  const triggerNames = new Set<string>();

  jobs.forEach((job: unknown, index) => {
    if (typeof job !== 'object' || job === null || Array.isArray(job)) {
      throw new CliError(
        `${environment}.scheduledJobs[${index}] must be an object`,
        'Infrastructure Config',
        'Each job has name, schedule and targetService; a trigger also an endpoint, a cron job "type": "cron"',
      );
    }

    const fields = job as Record<string, unknown>;
    const context = `${environment}.scheduledJobs.${typeof fields.name === 'string' ? fields.name : index}`;

    for (const field of REQUIRED_FIELDS) {
      if (typeof fields[field] !== 'string' || fields[field] === '') {
        throw new CliError(
          `${context}.${field} is missing`,
          'Infrastructure Config',
          'Each job has name, schedule and targetService; a trigger also an endpoint, a cron job "type": "cron"',
        );
      }
    }
    const name = fields.name as string;
    const targetService = fields.targetService as string;

    if (seen.has(name)) {
      throw new CliError(
        `Scheduled job "${name}" appears twice in ${environment}.scheduledJobs`,
        'Infrastructure Config',
        'Names are unique across the project, both kinds: they name the cloud schedules and job resources',
      );
    }
    seen.add(name);

    if (fields.type !== undefined) {
      validateEnum(fields.type, 'type', context, SCHEDULED_JOB_TYPES);
    }
    const isCron = fields.type === CRON_JOB_TYPE;
    (isCron ? cronNames : triggerNames).add(name);
    const validFields: readonly string[] = isCron
      ? VALID_CRON_JOB_FIELDS
      : VALID_TRIGGER_JOB_FIELDS;
    const otherKindFields: readonly string[] = isCron
      ? VALID_TRIGGER_JOB_FIELDS
      : VALID_CRON_JOB_FIELDS;

    for (const field of Object.keys(fields)) {
      if (validFields.includes(field)) continue;
      const ofOtherKind = otherKindFields.includes(field);
      throw new CliError(
        `Unknown field "${field}" in ${context}`,
        'Infrastructure Config',
        ofOtherKind
          ? isCron
            ? `"${field}" belongs to a trigger. A cron job ("type": "cron") runs the service's image and calls no endpoint; its fields: ${VALID_CRON_JOB_FIELDS.join(', ')}`
            : `"${field}" belongs to a cron job ("type": "cron"). A trigger calls an endpoint; its fields: ${VALID_TRIGGER_JOB_FIELDS.join(', ')}`
          : `Valid fields: ${validFields.join(', ')}`,
      );
    }

    if (serviceTypes) {
      if (!serviceTypes.has(targetService)) {
        throw new CliError(
          `${context}.targetService: "${targetService}" is not a service in config.json`,
          'Infrastructure Config',
          `Services: ${[...serviceTypes.keys()].join(', ')}`,
        );
      }
      const targetType = serviceTypes.get(targetService);
      if (isCron && targetType !== 'nestjs') {
        throw new CliError(
          `${context}.targetService: "${targetService}" is ${targetType ? `a ${targetType}` : 'not a NestJS'} service`,
          'Infrastructure Config',
          "A cron job runs a NestJS service's image with a different command (node dist/cron.js <name>)",
        );
      }
    }

    if (isCron) {
      validateCronJobFields(context, fields, provider);
    } else {
      validateTriggerJobFields(context, fields, provider);
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
  // A trigger's cloud resources are {project}-{name}, a cron job's
  // {project}-cron-{name}: "cron-x" and "x" would be one Container App Job
  for (const triggerName of triggerNames) {
    if (!triggerName.startsWith(CRON_JOB_NAME_PREFIX)) continue;
    const cronName = triggerName.slice(CRON_JOB_NAME_PREFIX.length);
    if (cronNames.has(cronName)) {
      throw new CliError(
        `Trigger "${triggerName}" and cron job "${cronName}" in ${environment}.scheduledJobs would share a cloud resource name (...-${triggerName})`,
        'Infrastructure Config',
        `A cron job's resources are named cron-{name}; rename the trigger or the cron job`,
      );
    }
  }
}
