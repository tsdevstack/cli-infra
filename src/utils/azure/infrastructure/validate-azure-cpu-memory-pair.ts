/**
 * Validate Azure CPU/Memory Pair
 *
 * Azure Container Apps enforces specific CPU/memory combinations.
 * CPU and memory cannot be set independently — only valid pairs are accepted.
 */

import { getContext } from '../../../context';

/**
 * Valid CPU/memory pairs for Azure Container Apps.
 * Each entry is [cpu, memory]. Source: Azure Container Apps documentation.
 */
const VALID_AZURE_CPU_MEMORY_PAIRS: readonly (readonly [string, string])[] = [
  ['0.25', '0.5Gi'],
  ['0.5', '1Gi'],
  ['0.75', '1.5Gi'],
  ['1', '2Gi'],
  ['1.25', '2.5Gi'],
  ['1.5', '3Gi'],
  ['1.75', '3.5Gi'],
  ['2', '4Gi'],
  ['2.25', '4.5Gi'],
  ['2.5', '5Gi'],
  ['2.75', '5.5Gi'],
  ['3', '6Gi'],
  ['3.25', '6.5Gi'],
  ['3.5', '7Gi'],
  ['3.75', '7.5Gi'],
  ['4', '8Gi'],
] as const;

/**
 * Validate that a CPU/memory combination is a valid Azure Container Apps pair.
 * Only call when BOTH cpu and memory are set in the override.
 *
 * @param cpu - CPU value from the override
 * @param memory - Memory value from the override
 * @param context - Error context string (e.g., "dev.auth-service")
 * @throws CliError if the combination is not a valid Azure pair
 */
export function validateAzureCpuMemoryPair(
  cpu: string,
  memory: string,
  context: string,
): void {
  const { CliError } = getContext();

  const isValidPair = VALID_AZURE_CPU_MEMORY_PAIRS.some(
    ([validCpu, validMemory]) => validCpu === cpu && validMemory === memory,
  );

  if (!isValidPair) {
    const validPairs = VALID_AZURE_CPU_MEMORY_PAIRS.map(
      ([c, m]) => `${c}/${m}`,
    ).join(', ');

    throw new CliError(
      `Invalid Azure CPU/memory combination "${cpu}/${memory}" in ${context}`,
      'Infrastructure Config',
      `Azure Container Apps requires specific CPU/memory pairs. Valid pairs: ${validPairs}`,
    );
  }
}
