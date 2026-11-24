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
          'legacy',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_run_revision" AND resource.labels.service_name="auth-service")',
      );
    });

    it("should use Kong's Cloud Run name", () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'kong', type: 'kong' },
          'shop',
          'legacy',
          {
            kind: 'app',
          },
        ),
      ).toBe(
        `(resource.type="cloud_run_revision" AND resource.labels.service_name="shop-kong" AND (${APP}))`,
      );
    });

    it('should read a migration job', () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'migrate-auth-service', type: 'migration' },
          'shop',
          'legacy',
          {
            kind: 'platform',
          },
        ),
      ).toBe(
        `(resource.type="cloud_run_job" AND resource.labels.job_name="migrate-auth-service" AND (NOT ${APP}))`,
      );
    });

    it('should read the database setup job by its one name in both naming schemes', () => {
      for (const naming of ['legacy', 'unique'] as const) {
        expect(
          buildGcpLogSourceFilter(
            { name: 'db-init', type: 'db-init' },
            'shop',
            naming,
            {},
          ),
        ).toBe(
          '(resource.type="cloud_run_job" AND resource.labels.job_name="shop-db-init")',
        );
      }
      expect(
        buildGcpLogSourceFilter(
          { name: 'db-init', type: 'db-init' },
          'shop',
          'legacy',
          { kind: 'app' },
        ),
      ).toBe(
        `(resource.type="cloud_run_job" AND resource.labels.job_name="shop-db-init" AND (${APP}))`,
      );
    });

    it("should read a scheduled job's runs and the load balancer", () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'sync-api-key-usage', type: 'job' },
          'shop',
          'legacy',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_scheduler_job" AND resource.labels.job_id="sync-api-key-usage")',
      );
      expect(
        buildGcpLogSourceFilter(
          { name: 'edge', type: 'edge' },
          'shop',
          'legacy',
          {},
        ),
      ).toBe(
        '(resource.type="http_load_balancer" AND resource.labels.url_map_name="shop-urlmap")',
      );
    });

    it('should filter app lines by pino level and platform lines by severity', () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'auth-service', type: 'service' },
          'shop',
          'legacy',
          {
            level: 'warn',
          },
        ),
      ).toBe(
        `(resource.type="cloud_run_revision" AND resource.labels.service_name="auth-service" AND ((${APP} AND (jsonPayload.level="warn" OR jsonPayload.level="error" OR jsonPayload.level="fatal")) OR (NOT ${APP} AND severity>=WARNING)))`,
      );
      expect(
        buildGcpLogSourceFilter(
          { name: 'edge', type: 'edge' },
          'shop',
          'legacy',
          {
            level: 'error',
          },
        ),
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
        'legacy',
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
          'legacy',
          { kind: 'edge' },
        ),
      ).toBeUndefined();
      expect(
        buildGcpLogSourceFilter(
          { name: 'edge', type: 'edge' },
          'shop',
          'legacy',
          {
            kind: 'app',
          },
        ),
      ).toBeUndefined();
    });
  });

  describe('Unique naming scheme', () => {
    it('should read services, migrations and jobs by their names with the project', () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'auth-service', type: 'service' },
          'shop',
          'unique',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_run_revision" AND resource.labels.service_name="shop-auth-service")',
      );
      expect(
        buildGcpLogSourceFilter(
          { name: 'migrate-auth-service', type: 'migration' },
          'shop',
          'unique',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_run_job" AND resource.labels.job_name="shop-migrate-auth-service")',
      );
      expect(
        buildGcpLogSourceFilter(
          { name: 'cleanup-tokens', type: 'job' },
          'shop',
          'unique',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_scheduler_job" AND resource.labels.job_id="shop-cleanup-tokens")',
      );
    });
  });

  describe('Storage buckets', () => {
    const bucket = {
      name: 'bucket-uploads',
      type: 'bucket' as const,
      bucket: 'uploads',
    };
    const env = { environment: 'dev', gcpProjectId: 'shop-dev-123456' };

    it("should read the bucket's Data Access audit logs by its GCS name", () => {
      expect(buildGcpLogSourceFilter(bucket, 'shop', 'legacy', env)).toBe(
        '(log_id("cloudaudit.googleapis.com/data_access") AND resource.type="gcs_bucket" AND resource.labels.bucket_name="shop-uploads-dev")',
      );
    });

    it('should use the unique name in the unique scheme', () => {
      expect(buildGcpLogSourceFilter(bucket, 'shop', 'unique', env)).toMatch(
        /resource\.labels\.bucket_name="shop-uploads-dev-[0-9a-f]{6}"\)$/,
      );
    });

    it('should leave --level to the printer (the level comes from the status)', () => {
      expect(
        buildGcpLogSourceFilter(bucket, 'shop', 'legacy', {
          ...env,
          level: 'warn',
          kind: 'platform',
        }),
      ).not.toContain('severity');
    });

    it('should read nothing for another kind, or without the environment', () => {
      expect(
        buildGcpLogSourceFilter(bucket, 'shop', 'legacy', {
          ...env,
          kind: 'app',
        }),
      ).toBeUndefined();
      expect(
        buildGcpLogSourceFilter(bucket, 'shop', 'legacy', {}),
      ).toBeUndefined();
    });
  });
  describe('Cron jobs', () => {
    it("should read a cron job's Cloud Run Job in both naming schemes", () => {
      expect(
        buildGcpLogSourceFilter(
          { name: 'usage-report', type: 'cron', service: 'auth-service' },
          'shop',
          'legacy',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_run_job" AND resource.labels.job_name="cron-usage-report")',
      );
      expect(
        buildGcpLogSourceFilter(
          { name: 'usage-report', type: 'cron', service: 'auth-service' },
          'shop',
          'unique',
          {},
        ),
      ).toBe(
        '(resource.type="cloud_run_job" AND resource.labels.job_name="shop-cron-usage-report")',
      );
    });
  });
});
