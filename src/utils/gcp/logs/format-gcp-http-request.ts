/**
 * Describe a request from Cloud Logging's httpRequest field:
 * "GET /auth/v1/me 200 12ms". Parts that are missing are left out. With
 * the host (load balancer lines, which serve several domains):
 * "GET api.example.com/auth/v1/me 200 12ms".
 */

import type { logging_v2 } from 'googleapis';

export function formatGcpHttpRequest(
  request: logging_v2.Schema$HttpRequest,
  options: { includeHost: boolean } = { includeHost: false },
): string {
  const parts: string[] = [];

  if (request.requestMethod) {
    parts.push(request.requestMethod);
  }

  if (request.requestUrl) {
    try {
      const url = new URL(request.requestUrl);
      const host = options.includeHost ? url.host : '';
      parts.push(`${host}${url.pathname}${url.search}`);
    } catch {
      parts.push(request.requestUrl);
    }
  }

  if (request.status !== undefined && request.status !== null) {
    parts.push(String(request.status));
  }

  // Latency is a duration in seconds: "0.012345s"
  if (request.latency) {
    const seconds = Number.parseFloat(request.latency);
    if (!Number.isNaN(seconds)) {
      parts.push(`${Math.round(seconds * 1000)}ms`);
    }
  }

  return parts.join(' ');
}
