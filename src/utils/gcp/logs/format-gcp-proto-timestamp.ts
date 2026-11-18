/**
 * A timestamp from Cloud Logging's tail stream as the REST API writes it
 * (RFC 3339, UTC, with 0, 3, 6 or 9 digits after the second).
 *
 * The stream's entries carry protobuf timestamps (`{ seconds, nanos }`,
 * seconds as text) or, after the SDK's own conversion, a Date. Returns
 * undefined for a missing or zero (unset) timestamp.
 */

export function formatGcpProtoTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
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
    !Number.isFinite(wholeSeconds) ||
    !Number.isInteger(nanoseconds) ||
    nanoseconds < 0 ||
    nanoseconds >= 1e9 ||
    (wholeSeconds === 0 && nanoseconds === 0)
  ) {
    return undefined;
  }

  const base = new Date(wholeSeconds * 1000).toISOString().slice(0, 19);
  if (nanoseconds === 0) {
    return `${base}Z`;
  }
  const digits = String(nanoseconds).padStart(9, '0');
  const fraction =
    nanoseconds % 1e6 === 0
      ? digits.slice(0, 3)
      : nanoseconds % 1e3 === 0
        ? digits.slice(0, 6)
        : digits;
  return `${base}.${fraction}Z`;
}
