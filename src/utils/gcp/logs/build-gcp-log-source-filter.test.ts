import { describe, it, expect } from '@rstest/core';
import { buildGcpLogSourceFilter } from './build-gcp-log-source-filter';

const APP =
  '(log_id("run.googleapis.com/stdout") OR log_id("run.googleapis.com/stderr"))';

describe('buildGcpLogSourceFilter', () => {
  describe('Standard use cases', () => {
    it('should read every line of a Cloud Run service', () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'auth-service', type: 'service' },
          'shop',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_run_revision" AND resource.labels.service_name="auth-service")',
      );
    });

    it("should use Kong's Cloud Run name", () => {
      expect(
        buildGcpLogSourceFilter({ name: 'kong', type: 'kong' }, 'shop', {
          kind: 'app',
        }),
      ).toBe(
        `(resource.type="cloud_run_revision" AND resource.labels.service_name="shop-kong" AND (${APP}))`,
      );
    });

    it('should read a migration job', () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'migrate-auth-service', type: 'migration' },
          'shop',
          {
            kind: 'platform',
          },
        ),
      ).toBe(
        `(resource.type="cloud_run_job" AND resource.labels.job_name="migrate-auth-service" AND (NOT ${APP}))`,
      );
    });

    it("should read a scheduled job's runs and the load balancer", () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'sync-api-key-usage', type: 'job' },
          'shop',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_scheduler_job" AND resource.labels.job_id="sync-api-key-usage")',
      );
      expect(
        buildGcpLogSourceFilter({ name: 'edge', type: 'edge' }, 'shop', {}),
      ).toBe(
        '(resource.type="http_load_balancer" AND resource.labels.url_map_name="shop-urlmap")',
      );
    });

    it('should filter app lines by pino level and platform lines by severity', () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'auth-service', type: 'service' },
          'shop',
          {
            level: 'warn',
          },
        ),
      ).toBe(
        `(resource.type="cloud_run_revision" AND resource.labels.service_name="auth-service" AND ((${APP} AND (jsonPayload.level="warn" OR jsonPayload.level="error" OR jsonPayload.level="fatal")) OR (NOT ${APP} AND severity>=WARNING)))`,
      );
      expect(
        buildGcpLogSourceFilter({ name: 'edge', type: 'edge' }, 'shop', {
          level: 'error',
        }),
      ).toBe(
        '(resource.type="http_load_balancer" AND resource.labels.url_map_name="shop-urlmap" AND (severity>=ERROR))',
      );
    });
  });

  describe('Edge cases', () => {
    it('should count pino trace lines as debug', () => {
      const filter = buildGcpLogSourceFilter(
        { name: 'auth-service', type: 'service' },
        'shop',
        {
          kind: 'app',
          level: 'debug',
        },
      );
      expect(filter).toContain(
        'jsonPayload.level="trace" OR jsonPayload.level="debug"',
      );
    });

    it('should return nothing when the source has no lines of the kind', () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'auth-service', type: 'service' },
          'shop',
          { kind: 'edge' },
        ),
      ).toBeUndefined();
      expect(
        buildGcpLogSourceFilter({ name: 'edge', type: 'edge' }, 'shop', {
          kind: 'app',
        }),
      ).toBeUndefined();
    });
  });
});
