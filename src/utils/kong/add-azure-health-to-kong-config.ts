/**
 * Add health check route to Kong config for Azure Front Door
 *
 * Azure Front Door probes Kong at /status to determine origin health.
 * Kong's status API lives on port 8100 (KONG_STATUS_LISTEN), which is
 * not the ingress port. This adds a /status route on the proxy port
 * using request-termination plugin to return 200 without hitting any upstream.
 *
 * Same pattern as AWS health check in add-aws-upstreams-to-kong-config.ts.
 */

import type { KongTemplate } from 'tsdevstack/plugin';

export function addAzureHealthToKongConfig(config: KongTemplate): KongTemplate {
  return {
    ...config,
    services: [
      ...config.services,
      {
        name: 'health-check',
        url: 'http://localhost:65535',
        routes: [
          {
            name: 'health-route',
            paths: ['/status'],
            strip_path: false,
          },
        ],
        plugins: [
          {
            name: 'request-termination',
            config: {
              status_code: 200,
              content_type: 'application/json',
              body: '{"status":"ok"}',
            },
          },
        ],
      },
    ],
  };
}
