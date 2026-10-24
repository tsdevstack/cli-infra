/**
 * Validate Cloud Run Resources
 *
 * Cloud Run rejects some cpu/memory/concurrency combinations at deploy time
 * (docs: configuring/services/cpu, configuring/services/memory-limits):
 * - Below 1 vCPU: concurrency must be 1 and billing request-based (CPU only
 *   during requests). Workers keep CPU always allocated, so they need 1 vCPU
 *   or more; Kong runs with Cloud Run's default concurrency (80).
 * - Memory per CPU: up to 512 MiB below 0.5 vCPU, 1 GiB below 1 vCPU, 4 GiB
 *   at 1 vCPU, 8 GiB at 2; at least 2 GiB at 4 vCPU and 4 GiB at 6 or 8.
 */

import { getContext } from '../../../context';
import { CLOUD_RUN_MEMORY_BY_CPU } from '../../../constants';
import { parseMemoryToNumber } from '../../infrastructure/parse-memory-to-number';

export function validateCloudRunResources(
  context: string,
  resources: { cpu: string; memory: string; concurrency?: number },
  kind: 'service' | 'worker' | 'kong',
): void {
  const { CliError } = getContext();
  const cpu = Number(resources.cpu);
  const where = `${context} (Cloud Run)`;

  if (cpu < 1) {
    if (kind === 'worker') {
      throw new CliError(
        `cpu "${resources.cpu}" is not possible for a worker on Cloud Run (${context})`,
        'Infrastructure Config',
        `Workers keep their CPU allocated between requests, which Cloud Run allows from 1 vCPU. Set "cpu" to "1" or more for ${context} in .tsdevstack/infrastructure.json.`,
      );
    }
    if (kind === 'kong') {
      throw new CliError(
        `cpu "${resources.cpu}" is not possible for Kong on Cloud Run (${context})`,
        'Infrastructure Config',
        `Below 1 vCPU, Cloud Run serves one request at a time per instance, and the gateway must serve many. Set "cpu" to "1" or more for ${context} in .tsdevstack/infrastructure.json.`,
      );
    }
    if (resources.concurrency !== 1) {
      throw new CliError(
        `cpu "${resources.cpu}" needs "concurrency": 1 on Cloud Run (${context} has ${resources.concurrency ?? 'the default'})`,
        'Infrastructure Config',
        `Below 1 vCPU, Cloud Run serves one request at a time per instance. Set "concurrency": 1 for ${context} in .tsdevstack/infrastructure.json, or "cpu" to "1".`,
      );
    }
  }

  const memoryMiB = parseMemoryToNumber(resources.memory);
  const limits = [...CLOUD_RUN_MEMORY_BY_CPU]
    .reverse()
    .find((entry) => cpu >= entry.cpu);

  if (limits && memoryMiB > limits.maxMiB) {
    throw new CliError(
      `memory "${resources.memory}" is more than Cloud Run allows with cpu "${resources.cpu}" (${where}: up to ${limits.maxMiB} MiB)`,
      'Infrastructure Config',
      `Raise "cpu" or lower "memory" for ${context} in .tsdevstack/infrastructure.json.`,
    );
  }
  if (limits && memoryMiB < limits.minMiB) {
    throw new CliError(
      `memory "${resources.memory}" is less than Cloud Run requires with cpu "${resources.cpu}" (${where}: at least ${limits.minMiB} MiB)`,
      'Infrastructure Config',
      `Raise "memory" or lower "cpu" for ${context} in .tsdevstack/infrastructure.json.`,
    );
  }
}
