/**
 * Parse an infra:logs time option: a duration back from now (30m, 1h, 2d)
 * or a timestamp. Timestamps without a time zone are read as UTC, the zone
 * the output uses.
 */

import { getContext } from '../../context';

const DURATION_PATTERN = /^(\d+)([smhd])$/;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

const HAS_TIME_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

export function parseLogTime(value: string, now: Date): Date {
  const { CliError } = getContext();
  const trimmed = value.trim();

  const duration = DURATION_PATTERN.exec(trimmed);
  if (duration) {
    const amount = Number(duration[1]);
    return new Date(now.getTime() - amount * UNIT_MS[duration[2]]);
  }

  // "2026-10-30 14:00" and "2026-10-30T14:00" mean UTC, like the output
  let timestamp = trimmed.replace(' ', 'T');
  if (timestamp.includes('T') && !HAS_TIME_ZONE.test(timestamp)) {
    timestamp = `${timestamp}Z`;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new CliError(
      `Invalid time: ${value}`,
      'infra:logs',
      'Use a duration such as 30m, 1h or 2d, or a UTC time such as 2026-10-30T14:00',
    );
  }

  return parsed;
}
