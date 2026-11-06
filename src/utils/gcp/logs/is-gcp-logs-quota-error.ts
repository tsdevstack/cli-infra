/**
 * Whether an error from Cloud Logging is its read limit (60 entries.list
 * calls per minute per project, which cannot be raised)
 */

export function isGcpLogsQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { status, code, message } = error as Record<string, unknown>;
  if (status === 429 || code === 429 || code === '429' || code === 8) {
    return true;
  }

  return (
    typeof message === 'string' &&
    (message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('Quota exceeded'))
  );
}
