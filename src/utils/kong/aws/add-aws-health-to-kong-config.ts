/**
 * Add health check route to Kong config for the AWS ALB
 *
 * The ALB target group for Kong checks GET /health on the proxy port (8080).
 * Kong's status API lives on port 8100 (KONG_STATUS_LISTEN), which the ALB
 * does not reach, so this adds a /health route on the proxy port that returns
 * 200 through the request-termination plugin, without any upstream.
 *
 * Service URLs are not rewritten here: the ${SERVICE_URL} placeholders are
 * resolved from Secrets Manager at build time, where infra:deploy stores the
 * Cloud Map URLs (http://{service}.{project}.local:8080).
 */

import type { KongTemplate } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { buildUntracedPlugins } from '../build-untraced-plugins';
import { buildHealthRouteLimitPlugins } from '../build-health-route-limit-plugins';

export function addAwsHealthToKongConfig(config: KongTemplate): KongTemplate {
  const { KONG_AWS_PROBE_PATH } = getContext();

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
            paths: [KONG_AWS_PROBE_PATH],
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
          // Probes every few seconds: not traced
          ...buildUntracedPlugins(config),
          // Probes never count against the global rate limit
          ...buildHealthRouteLimitPlugins(config),
        ],
      },
    ],
  };
}
