/**
 * Validate Fargate CPU/Memory Pair
 *
 * Fargate runs a task only at certain CPU and memory combinations.
 * infrastructure.json takes cpu and memory separately, so an invalid pair
 * (1 vCPU with 512Mi) used to pass validation and fail at deploy. Called
 * with the merged values: a value the user didn't set comes from the
 * defaults, and the pair has to be valid as a whole.
 */

import { getContext } from '../../../context';
import { FARGATE_MEMORY_BY_CPU } from '../../../constants';
import { parseMemoryToNumber } from '../../infrastructure/parse-memory-to-number';

/**
 * Throw when a CPU/memory pair is not one Fargate runs
 *
 * @param cpu - vCPU as in infrastructure.json ("0.5", "1")
 * @param memory - Memory as in infrastructure.json ("512Mi", "2Gi")
 * @param context - Where the values come from (e.g. "dev.auth-service")
 * @throws CliError if Fargate has no such pair
 */
export function validateFargateCpuMemoryPair(
  cpu: string,
  memory: string,
  context: string,
): void {
  const { CliError } = getContext();

  const cpuValue = parseFloat(cpu);
  const memoryMiB = parseMemoryToNumber(memory);
  const row = FARGATE_MEMORY_BY_CPU.find((entry) => entry.cpu === cpuValue);

  if (row && row.memoryMiB.includes(memoryMiB)) {
    return;
  }

  const allowed = row
    ? `With ${cpu} vCPU, memory can be ${row.memoryMiB
        .map((mib) => (mib < 1024 ? `${mib}Mi` : `${mib / 1024}Gi`))
        .join(', ')}.`
    : `Fargate takes ${FARGATE_MEMORY_BY_CPU.map((entry) => entry.cpu).join(', ')} vCPU.`;

  throw new CliError(
    `Invalid AWS Fargate CPU/memory pair "${cpu}/${memory}" in ${context}`,
    'Infrastructure Config',
    `${allowed} A value you don't set comes from the defaults, so set both cpu and memory.`,
  );
}
