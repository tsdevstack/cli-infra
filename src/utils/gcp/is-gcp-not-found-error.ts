/**
 * Whether a Google API call failed with 404 (not found). The clients put the
 * HTTP status in different places: the googleapis clients on `code`, gaxios
 * (GoogleAuth.request) on `status` and `response.status`.
 */
export function isGcpNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, status, response } = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  return code === 404 || status === 404 || response?.status === 404;
}
