/**
 * Enforce Kong Min Instances
 *
 * Kong is the API gateway that wakes up scaled-to-zero services.
 * If Kong itself scales to zero, nothing can wake it up.
 * This utility enforces minInstances >= 1 for Kong.
 */

interface Logger {
  warn: (message: string) => void;
}

/**
 * Enforce Kong minInstances >= 1
 *
 * @param minInstances - The configured minInstances value
 * @param logger - Logger instance for warnings
 * @returns The enforced minInstances value (at least 1)
 */
export function enforceKongMinInstances(
  minInstances: number,
  logger: Logger,
): number {
  if (minInstances < 1) {
    logger.warn(
      'Kong minInstances cannot be 0 (Kong must be running to wake other services). Forcing minInstances to 1.',
    );
    return 1;
  }
  return minInstances;
}
