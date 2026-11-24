/**
 * Validate a cron job's own fields: name, timeout, cpu and memory
 *
 * The name becomes container resource names on every cloud. The timeout is
 * the run's limit, which the runner enforces itself, capped per cloud. CPU
 * and memory take the migration job's values and defaults, and the pair has
 * to be one the cloud runs (Azure, Fargate).
 */

import {
  CRON_JOB_NAME_MAX_LENGTH,
  CRON_JOB_NAME_PATTERN,
  CRON_JOB_TIMEOUT,
} from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import {
  CRON_TIMEOUT_LIMIT_REASONS,
  ECS_CPU_UNITS_PER_VCPU,
  MIGRATION_JOB_DEFAULTS_AWS,
  MIGRATION_JOB_DEFAULTS_AZURE,
} from '../../constants';
import type { SchemaProvider } from './get-provider-schema-config';
import { getProviderSchemaConfig } from './get-provider-schema-config';
import { validateEnum } from './validate-enum';
import { validateAzureCpuMemoryPair } from '../azure/infrastructure/validate-azure-cpu-memory-pair';
import { validateFargateCpuMemoryPair } from '../aws/infrastructure/validate-fargate-cpu-memory-pair';

/**
 * @param context - Where the entry is, for the messages (dev.scheduledJobs.report)
 * @param fields - The entry's fields (name is a string by now)
 * @param provider - Cloud provider of the project
 * @throws CliError on a name that isn't kebab-case, a timeout outside the
 *   cloud's limits, a cpu or memory value the migration job doesn't take, or
 *   a pair the cloud doesn't run
 */
export function validateCronJobFields(
  context: string,
  fields: Record<string, unknown>,
  provider: SchemaProvider,
): void {
  const { CliError } = getContext();

  const name = fields.name as string;
  if (
    !CRON_JOB_NAME_PATTERN.test(name) ||
    name.includes('--') ||
    name.length > CRON_JOB_NAME_MAX_LENGTH
  ) {
    throw new CliError(
      `${context}.name: "${name}" must be kebab-case (lowercase letters, digits and single hyphens, starting with a letter), at most ${CRON_JOB_NAME_MAX_LENGTH} characters`,
      'Infrastructure Config',
      "A cron job's name names its handler file, its class and its cloud job resources. Example: usage-report",
    );
  }

  if (fields.timeout !== undefined) {
    const { min, max } = CRON_JOB_TIMEOUT[provider];
    const timeout = fields.timeout;
    if (
      typeof timeout !== 'number' ||
      !Number.isInteger(timeout) ||
      timeout < min ||
      timeout > max
    ) {
      throw new CliError(
        `${context}.timeout: ${String(timeout)} is not a whole number of seconds from ${min} to ${max}`,
        'Infrastructure Config',
        `${CRON_TIMEOUT_LIMIT_REASONS[provider]} The runner stops the run at the timeout through the handler's signal; the platform's SIGTERM is the backstop.`,
      );
    }
  }

  const { migrationJobCpuValues, migrationJobMemoryValues } =
    getProviderSchemaConfig(provider);
  if (fields.cpu !== undefined) {
    validateEnum(fields.cpu, 'cpu', context, migrationJobCpuValues);
  }
  if (fields.memory !== undefined) {
    validateEnum(fields.memory, 'memory', context, migrationJobMemoryValues);
  }

  // The pair as a whole: the value not set comes from the migration job's
  // defaults, and the message says so
  if (fields.cpu !== undefined || fields.memory !== undefined) {
    const defaults =
      provider === 'aws'
        ? MIGRATION_JOB_DEFAULTS_AWS
        : MIGRATION_JOB_DEFAULTS_AZURE;
    const cpu = (fields.cpu as string | undefined) ?? defaults.cpu;
    const memory = (fields.memory as string | undefined) ?? defaults.memory;
    const pairContext =
      fields.memory === undefined
        ? `${context} (memory ${memory} is the default)`
        : fields.cpu === undefined
          ? `${context} (cpu ${cpu} is the default)`
          : context;
    if (provider === 'azure') {
      validateAzureCpuMemoryPair(cpu, memory, pairContext);
    } else if (provider === 'aws') {
      validateFargateCpuMemoryPair(
        String(Number(cpu) / ECS_CPU_UNITS_PER_VCPU),
        `${Number(memory)}Mi`,
        pairContext,
      );
    }
  }
}
