/**
 * A duration from Cloud Logging's tail stream (`{ seconds, nanos }`, seconds
 * as text) as the REST API writes it: "0.012s", "3s". Returns undefined for
 * a missing or zero (unset) duration.
 */

export function formatGcpProtoDuration(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value || undefined;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const { seconds, nanos } = value as { seconds?: unknown; nanos?: unknown };
  const wholeSeconds = Number(seconds ?? 0);
  const nanoseconds = Number(nanos ?? 0);
  if (
    !Number.isInteger(wholeSeconds) ||
    !Number.isInteger(nanoseconds) ||
    wholeSeconds < 0 ||
    nanoseconds < 0 ||
    nanoseconds >= 1e9 ||
    (wholeSeconds === 0 && nanoseconds === 0)
  ) {
    return undefined;
  }

  if (nanoseconds === 0) {
    return `${wholeSeconds}s`;
  }
  const digits = String(nanoseconds).padStart(9, '0');
  const fraction =
    nanoseconds % 1e6 === 0
      ? digits.slice(0, 3)
      : nanoseconds % 1e3 === 0
        ? digits.slice(0, 6)
        : digits;
  return `${wholeSeconds}.${fraction}s`;
}
