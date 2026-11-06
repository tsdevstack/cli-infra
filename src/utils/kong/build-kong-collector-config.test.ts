import { describe, it, expect } from '@rstest/core';
import { buildKongCollectorConfig } from './build-kong-collector-config';

const destination = {
  extensions: { sigv4auth: { region: 'eu-west-1', service: 'xray' } },
  processors: { resource: { attributes: [] } },
  exporters: { otlp_http: { traces_endpoint: 'https://x/v1/traces' } },
};

describe('buildKongCollectorConfig', () => {
  describe('Standard use cases', () => {
    it("should receive Kong's spans on localhost and send them to the destination", () => {
      const config = buildKongCollectorConfig(destination);

      expect(config.receivers).toEqual({
        otlp: { protocols: { http: { endpoint: 'localhost:4318' } } },
      });
      expect(config.exporters).toEqual(destination.exporters);
      expect(config.service).toMatchObject({
        extensions: ['health_check', 'sigv4auth'],
        pipelines: {
          traces: {
            receivers: ['otlp'],
            processors: ['memory_limiter', 'resource', 'batch'],
            exporters: ['otlp_http'],
          },
        },
      });
    });

    it('should limit its memory before any other processor', () => {
      const config = buildKongCollectorConfig(destination);

      expect(config.processors).toEqual({
        memory_limiter: {
          check_interval: '1s',
          limit_mib: 200,
          spike_limit_mib: 50,
        },
        resource: { attributes: [] },
        batch: {},
      });
    });
  });

  describe('Edge cases', () => {
    it('should answer health checks and keep its own metrics off', () => {
      const config = buildKongCollectorConfig({
        extensions: {},
        processors: {},
        exporters: { azure_monitor: {} },
      });

      expect(config.extensions).toEqual({
        health_check: { endpoint: '0.0.0.0:13133' },
      });
      expect(config.service).toMatchObject({
        extensions: ['health_check'],
        pipelines: { traces: { processors: ['memory_limiter', 'batch'] } },
        telemetry: { metrics: { level: 'none' } },
      });
    });
  });
});
