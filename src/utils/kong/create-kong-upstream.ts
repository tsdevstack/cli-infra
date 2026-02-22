/**
 * Create Kong upstream config for AWS
 *
 * Upstreams route to ALB internal listener with Host header routing.
 * ALB routes based on Host: {service}.internal to the correct target group.
 *
 * Wake-up mechanism for scale-to-zero is handled by post-function plugin,
 * not upstream failover. See Phase 21.11d in docs/in-dev/phase-21-aws-service-discovery-fix.md
 *
 * See: docs/in-dev/phase-21-aws-architecture.md
 */

import type { KongUpstream } from 'tsdevstack/plugin';

interface CreateKongUpstreamOptions {
  serviceName: string;
}

export function createKongUpstream(
  options: CreateKongUpstreamOptions,
): KongUpstream {
  const { serviceName } = options;

  const upstreamName = `${serviceName}-upstream`;

  return {
    name: upstreamName,
    algorithm: 'round-robin',
    // Host header for ALB routing
    host_header: `${serviceName}.internal`,
    healthchecks: {
      active: {
        type: 'https',
        http_path: '/health',
        https_verify_certificate: false, // Self-signed/internal certs
        // Host header required for ALB host-based routing
        headers: { Host: [`${serviceName}.internal`] },
        healthy: {
          interval: 5,
          successes: 1,
          http_statuses: [200],
        },
        unhealthy: {
          interval: 3,
          http_failures: 1,
          tcp_failures: 1,
          timeouts: 1,
          http_statuses: [500, 502, 503, 504],
        },
      },
      passive: {
        healthy: {
          successes: 1,
          http_statuses: [200, 201, 204],
        },
        unhealthy: {
          http_failures: 1,
          tcp_failures: 1,
          timeouts: 1,
          http_statuses: [500, 502, 503, 504],
        },
      },
    },
    targets: [
      // ALB internal HTTPS listener on port 8443
      { target: '${ALB_INTERNAL_DNS}:8443', weight: 1000 },
    ],
  };
}
