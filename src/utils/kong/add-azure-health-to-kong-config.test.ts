import { describe, it, expect } from '@rstest/core';
import { addAzureHealthToKongConfig } from './add-azure-health-to-kong-config';
import type { KongTemplate } from 'tsdevstack/plugin';

describe('addAzureHealthToKongConfig', () => {
  const baseConfig: KongTemplate = {
    _format_version: '3.0',
    _transform: true,
    services: [
      {
        name: 'auth-service-public',
        url: '${AUTH_SERVICE_URL}',
        routes: [{ name: 'auth-route', paths: ['/auth'], strip_path: false }],
      },
    ],
  };

  it('should add health-check service with /status route', () => {
    const result = addAzureHealthToKongConfig(baseConfig);

    const healthService = result.services.find(
      (s) => s.name === 'health-check',
    );
    expect(healthService).toBeDefined();
    expect(healthService!.routes[0].paths).toEqual(['/status']);
    expect(healthService!.routes[0].name).toBe('health-route');
    expect(healthService!.routes[0].strip_path).toBe(false);
  });

  it('should use request-termination plugin to return 200', () => {
    const result = addAzureHealthToKongConfig(baseConfig);

    const healthService = result.services.find(
      (s) => s.name === 'health-check',
    );
    expect(healthService!.plugins).toHaveLength(1);
    expect(healthService!.plugins![0].name).toBe('request-termination');
    expect(healthService!.plugins![0].config.status_code).toBe(200);
    expect(healthService!.plugins![0].config.content_type).toBe(
      'application/json',
    );
    expect(healthService!.plugins![0].config.body).toBe('{"status":"ok"}');
  });

  it('should preserve existing services', () => {
    const result = addAzureHealthToKongConfig(baseConfig);

    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe('auth-service-public');
  });

  it('should not mutate input config', () => {
    const originalLength = baseConfig.services.length;
    addAzureHealthToKongConfig(baseConfig);
    expect(baseConfig.services).toHaveLength(originalLength);
  });

  it('should use dummy URL for health service', () => {
    const result = addAzureHealthToKongConfig(baseConfig);

    const healthService = result.services.find(
      (s) => s.name === 'health-check',
    );
    expect(healthService!.url).toBe('http://localhost:65535');
  });
});
