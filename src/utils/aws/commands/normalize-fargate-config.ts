/**
 * Fargate Default Configuration
 *
 * AWS Fargate has strict CPU/memory combinations.
 * This module provides the smallest valid config as default.
 *
 * Valid Fargate combinations:
 * - 256 CPU: 512, 1024, 2048 MB
 * - 512 CPU: 1024, 2048, 3072, 4096 MB
 * - 1024 CPU: 2048, 3072, 4096, 5120, 6144, 7168, 8192 MB
 * - 2048 CPU: 4096-16384 MB (1024 increments)
 * - 4096 CPU: 8192-30720 MB (1024 increments)
 */

export interface FargateConfig {
  cpu: number;
  memory: number;
}

/**
 * Smallest valid Fargate configuration (cheapest)
 */
export const FARGATE_DEFAULT: FargateConfig = {
  cpu: 256,
  memory: 512,
};
