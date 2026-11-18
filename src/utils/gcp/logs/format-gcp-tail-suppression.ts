/**
 * The notices for lines Cloud Logging's tail stream left out (a response's
 * suppressionInfo: a reason and at least how many lines). Google leaves
 * lines out above its live limit (60,000 a minute per project) and when the
 * reader falls behind.
 */

export function formatGcpTailSuppression(suppressionInfo: unknown): string[] {
  const items = Array.isArray(suppressionInfo)
    ? suppressionInfo
    : suppressionInfo
      ? [suppressionInfo]
      : [];

  const notices: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const { reason, suppressedCount } = item as {
      reason?: unknown;
      suppressedCount?: unknown;
    };
    const count = Number(suppressedCount ?? 0);
    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }
    const why =
      reason === 'RATE_LIMIT' || reason === 1
        ? "over Google's live limit of 60,000 lines a minute"
        : reason === 'NOT_CONSUMED' || reason === 2
          ? 'they came faster than they could be printed'
          : 'no reason given';
    notices.push(
      `Cloud Logging left out at least ${count} line${count === 1 ? '' : 's'} (${why}).`,
    );
  }
  return notices;
}
