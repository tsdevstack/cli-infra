import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { addAwsHealthToKongConfig } from './add-aws-health-to-kong-config';
import type { KongTemplate } from '@tsdevstack/cli/plugin';

describe('addAwsHealthToKongConfig', () => {
  const baseConfig: KongTemplate = {
    _format_version: '3.0',
    _transform: true,
    services: [
      {
        name: 'auth-service-public',
        url: '${AUTH_SERVICE_URL}',
        routes: [
          {
            name: 'auth-service-public-auth-v1-auth-login',
            paths: ['~/auth/v1/auth/login$'],
            methods: ['POST', 'OPTIONS'],
            strip_path: false,
          },
        ],
        plugins: [
          {
            name: 'oidc',
            config: {
              discovery:
                '${AUTH_SERVICE_URL}/auth/.well-known/openid-configuration',
            },
          },
        ],
      },
    ],
    plugins: [{ name: 'tsdevstack-strip-identity', config: {} }],
  };

  describe('Standard use cases', () => {
    it('should add a health-check service on /health for the ALB target group', () => {
      const result = addAwsHealthToKongConfig(baseConfig);

      const healthService = result.services.find(
        (s) => s.name === 'health-check',
      );
      expect(healthService).toEqual({
        name: 'health-check',
        url: 'http://localhost:65535',
        routes: [
          { name: 'health-route', paths: ['/health'], strip_path: false },
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
      });
    });

    it('should keep service URL and OIDC discovery placeholders for build-time resolution', () => {
      const result = addAwsHealthToKongConfig(baseConfig);

      expect(result.services[0]).toEqual(baseConfig.services[0]);
    });

    it('should add no upstreams and no global plugins', () => {
      const result = addAwsHealthToKongConfig(baseConfig);

      expect(result.upstreams).toBeUndefined();
      expect(result.plugins).toEqual(baseConfig.plugins);
    });
  });

  describe('Edge cases', () => {
    it('should not mutate the input config', () => {
      addAwsHealthToKongConfig(baseConfig);

      expect(baseConfig.services).toHaveLength(1);
    });
  });
  it('should not trace the health route (its own tracing plugin at rate 0)', () => {
    const result = addAwsHealthToKongConfig({
      services: [],
      plugins: [
        {
          name: 'opentelemetry',
          config: {
            traces_endpoint: 'http://localhost:4318/v1/traces',
            sampling_rate: 1,
          },
        },
      ],
    });

    const health = result.services.find((s) => s.name === 'health-check');
    expect(health?.routes?.[0].paths).toEqual(['/health']);
    expect(health?.plugins).toContainEqual({
      name: 'opentelemetry',
      config: {
        traces_endpoint: 'http://localhost:4318/v1/traces',
        sampling_rate: 0,
      },
    });
    expect(result.plugins?.[0].config.sampling_rate).toBe(1);
  });
});
