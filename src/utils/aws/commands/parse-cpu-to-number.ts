/**
 * Parse CPU string to AWS Fargate CPU units
 *
 * Converts GCP-style CPU strings (e.g., "1", "2") to AWS Fargate CPU units.
 * AWS Fargate uses specific CPU unit values: 256, 512, 1024, 2048, 4096.
 *
 * Conversion: 1 vCPU = 1024 units
 */

export function parseCpuToNumber(cpu: string | number): number {
  const cpuValue = typeof cpu === 'number' ? cpu : parseFloat(cpu);

  // Convert vCPU to Fargate CPU units (1 vCPU = 1024 units)
  return Math.round(cpuValue * 1024);
}
