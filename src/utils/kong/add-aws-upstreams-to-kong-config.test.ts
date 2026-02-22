import { describe, it, expect } from '@rstest/core';
import { addAwsUpstreamsToKongConfig } from './add-aws-upstreams-to-kong-config';
import type { KongTemplate } from 'tsdevstack/plugin';

describe('addAwsUpstreamsToKongConfig', () => {
  const baseConfig: KongTemplate = {
    _format_version: '3.0',
    _transform: true,
    services: [
      {
        name: 'auth-service-public',
        url: '${AUTH_SERVICE_URL}',
        routes: [{ name: 'auth-route', paths: ['/auth'], strip_path: false }],
      },
      {
        name: 'offers-service-public',
        url: '${OFFERS_SERVICE_URL}/offers',
        routes: [
          { name: 'offers-route', paths: ['/offers'], strip_path: false },
        ],
      },
    ],
  };

  it('should transform service URLs to upstream references', () => {
    const result = addAwsUpstreamsToKongConfig(baseConfig, {
      projectName: 'tsdevstack',
    });

    // First service is the health-check service (AWS-specific)
    expect(result.services[0].name).toBe('health-check');

    // Second service is oidc-discovery (for Kong OIDC plugin)
    expect(result.services[1].name).toBe('oidc-discovery');
    expect(result.services[1].url).toBe('http://${ALB_INTERNAL_DNS}:8080');

    // HTTPS required for ALB:8443 (HTTPS)
    expect(result.services[2].url).toBe('https://auth-service-upstream');
    expect(result.services[3].url).toBe(
      'https://offers-service-upstream/offers',
    );
  });

  it('should create upstreams for each service', () => {
    const result = addAwsUpstreamsToKongConfig(baseConfig, {
      projectName: 'tsdevstack',
    });

    expect(result.upstreams).toHaveLength(2);
    expect(result.upstreams![0].name).toBe('auth-service-upstream');
    expect(result.upstreams![1].name).toBe('offers-service-upstream');
  });

  it('should use ALB internal HTTPS listener as only target', () => {
    const result = addAwsUpstreamsToKongConfig(baseConfig, {
      projectName: 'myproject',
    });

    // Only ALB target - no Lambda failover (handled by post-function plugin)
    expect(result.upstreams![0].targets).toHaveLength(1);
    expect(result.upstreams![0].targets[0].target).toBe(
      '${ALB_INTERNAL_DNS}:8443',
    );
    expect(result.upstreams![0].targets[0].weight).toBe(1000);
  });

  it('should set host_header for ALB host-based routing', () => {
    const result = addAwsUpstreamsToKongConfig(baseConfig, {
      projectName: 'tsdevstack',
    });

    expect(result.upstreams![0].host_header).toBe('auth-service.internal');
    expect(result.upstreams![1].host_header).toBe('offers-service.internal');
  });

  it('should add global post-function plugin for wake-up', () => {
    const result = addAwsUpstreamsToKongConfig(baseConfig, {
      projectName: 'tsdevstack',
    });

    expect(result.plugins).toBeDefined();
    const postFunctionPlugin = result.plugins!.find(
      (p) => p.name === 'post-function',
    );
    expect(postFunctionPlugin).toBeDefined();

    const config = postFunctionPlugin!.config as { header_filter: string[] };
    expect(config.header_filter).toBeDefined();
    expect(config.header_filter[0]).toContain('kong.response.get_status()');
    expect(config.header_filter[0]).toContain('WAKEUP_LAMBDA_URL');
  });

  it('should preserve existing plugins and add wake-up plugin', () => {
    const configWithPlugins: KongTemplate = {
      ...baseConfig,
      consumers: [{ username: 'test-user' }],
      plugins: [{ name: 'cors', config: { origins: ['*'] } }],
    };

    const result = addAwsUpstreamsToKongConfig(configWithPlugins, {
      projectName: 'tsdevstack',
    });

    expect(result.consumers).toEqual([{ username: 'test-user' }]);
    expect(result.plugins).toHaveLength(2);
    expect(result.plugins![0].name).toBe('cors');
    expect(result.plugins![1].name).toBe('post-function');
  });

  it('should not transform non-placeholder URLs', () => {
    const configWithStaticUrl: KongTemplate = {
      _format_version: '3.0',
      _transform: true,
      services: [
        {
          name: 'external-service',
          url: 'https://api.external.com',
          routes: [
            { name: 'external-route', paths: ['/external'], strip_path: false },
          ],
        },
      ],
    };

    const result = addAwsUpstreamsToKongConfig(configWithStaticUrl, {
      projectName: 'tsdevstack',
    });

    // First service is health-check, second is oidc-discovery, third is the external service (unchanged)
    expect(result.services[0].name).toBe('health-check');
    expect(result.services[1].name).toBe('oidc-discovery');
    expect(result.services[2].url).toBe('https://api.external.com');
    expect(result.upstreams).toHaveLength(0);
  });
});
