/**
 * A run's duration for a log line: 3 ms, 68.6 s, 12 min 5 s
 */

export function formatRunDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }
  // Tenths of a second, so 59.96 s shows as 1 min 0 s, not 60.0 s
  const tenths = Math.round(milliseconds / 100);
  if (tenths < 600) {
    return `${(tenths / 10).toFixed(1)} s`;
  }
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
