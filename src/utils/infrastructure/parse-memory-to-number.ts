/**
 * Parse memory string to MiB
 *
 * Converts memory strings from infrastructure.json (e.g., "512Mi", "1Gi")
 * to MiB: AWS Fargate takes the number, Cloud Run limits are checked with it.
 * Handles both "Mi" (mebibytes) and "Gi" (gibibytes) suffixes.
 */

export function parseMemoryToNumber(memory: string | number): number {
  if (typeof memory === 'number') {
    return memory;
  }

  const match = memory.match(/^(\d+(?:\.\d+)?)(Mi|Gi)?$/);
  if (!match) {
    // If no unit, assume MB
    return parseInt(memory, 10);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (unit === 'Gi') {
    return Math.round(value * 1024);
  }

  // Mi or no unit = MB
  return Math.round(value);
}
