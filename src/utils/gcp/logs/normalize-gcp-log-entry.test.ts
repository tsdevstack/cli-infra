import { describe, it, expect } from '@rstest/core';
import { normalizeGcpLogEntry } from './normalize-gcp-log-entry';

const RUN = (service: string) => ({
  type: 'cloud_run_revision',
  labels: { service_name: service, revision_name: `${service}-00001-abc` },
});

describe('normalizeGcpLogEntry', () => {
  describe('Standard use cases', () => {
    it('should read our pino JSON lines', () => {
      const entry = {
        logName: 'projects/p/logs/run.googleapis.com%2Fstdout',
        resource: RUN('auth-service'),
        timestamp: '2026-10-30T12:00:01.123456789Z',
        severity: 'DEFAULT',
        jsonPayload: {
          level: 'warn',
          time: '2026-10-30T12:00:01.123Z',
          pid: 1,
          hostname: 'localhost',
          service: 'auth-service',
          context: 'AuthService',
          correlationId: 'req-1',
          msg: 'Slow query',
        },
      };

      expect(normalizeGcpLogEntry(entry, 'shop')).toEqual({
        time: '2026-10-30T12:00:01.123Z',
        source: 'auth-service',
        kind: 'app',
        level: 'warn',
        message: 'Slow query',
        fields: { context: 'AuthService', correlationId: 'req-1' },
        raw: entry,
      });
    });

    it("should read plain text output without a level and name Kong's service kong", () => {
      const entry = {
        logName: 'projects/p/logs/run.googleapis.com%2Fstderr',
        resource: RUN('shop-kong'),
        timestamp: '2026-10-30T12:00:01Z',
        severity: 'ERROR',
        textPayload: '2026/10/30 12:00:01 [notice] 1#0: start worker processes',
      };

      const line = normalizeGcpLogEntry(entry, 'shop');
      expect(line.source).toBe('kong');
      expect(line.kind).toBe('app');
      expect(line.level).toBeUndefined();
      expect(line.message).toBe(
        '2026/10/30 12:00:01 [notice] 1#0: start worker processes',
      );
    });

    it("should read Cloud Run's request logs as platform lines", () => {
      const line = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/run.googleapis.com%2Frequests',
          resource: RUN('frontend'),
          timestamp: '2026-10-30T12:00:01Z',
          severity: 'WARNING',
          httpRequest: {
            requestMethod: 'GET',
            requestUrl: 'https://frontend-abc.a.run.app/login',
            status: 404,
            latency: '0.004s',
          },
        },
        'shop',
      );
      expect(line).toMatchObject({
        source: 'frontend',
        kind: 'platform',
        level: 'warn',
        message: 'GET /login 404 4ms',
      });
    });

    it("should read Cloud Run's system logs and migration jobs", () => {
      const line = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/run.googleapis.com%2Fvarlog%2Fsystem',
          resource: {
            type: 'cloud_run_job',
            labels: { job_name: 'migrate-auth-service' },
          },
          timestamp: '2026-10-30T12:00:01Z',
          severity: 'ERROR',
          textPayload: 'Container called exit(1).',
        },
        'shop',
      );
      expect(line).toMatchObject({
        source: 'migrate-auth-service',
        kind: 'platform',
        level: 'error',
        message: 'Container called exit(1).',
      });
    });

    it('should read load balancer lines as edge, with the reason it answered itself', () => {
      const line = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/requests',
          resource: {
            type: 'http_load_balancer',
            labels: { url_map_name: 'shop-urlmap' },
          },
          timestamp: '2026-10-30T12:00:01Z',
          severity: 'WARNING',
          httpRequest: {
            requestMethod: 'POST',
            requestUrl: 'https://example.com/api',
            status: 403,
          },
          jsonPayload: {
            statusDetails: 'denied_by_security_policy',
            enforcedSecurityPolicy: {
              name: 'shop-security-policy',
              priority: 1000,
              outcome: 'DENY',
              preconfiguredExprIds: ['owasp-crs-v030301-id942100-sqli'],
            },
          },
        },
        'shop',
      );
      expect(line).toMatchObject({
        source: 'edge',
        kind: 'edge',
        level: 'warn',
        message:
          'POST example.com/api 403 blocked by shop-security-policy rule 1000 (owasp-crs-v030301-id942100-sqli)',
      });
    });

    it('should say why the load balancer answered when no backend did', () => {
      const line = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/requests',
          resource: {
            type: 'http_load_balancer',
            labels: { url_map_name: 'shop-urlmap' },
          },
          timestamp: '2026-10-30T12:00:01Z',
          severity: 'ERROR',
          httpRequest: {
            requestMethod: 'GET',
            requestUrl: 'https://api.example.com/auth/v1/me',
            status: 502,
          },
          jsonPayload: { statusDetails: 'failed_to_connect_to_backend' },
        },
        'shop',
      );
      expect(line.message).toBe(
        'GET api.example.com/auth/v1/me 502 (failed_to_connect_to_backend)',
      );
    });

    it("should read Cloud Scheduler's runs as platform lines", () => {
      const started = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/cloudscheduler.googleapis.com%2Fexecutions',
          resource: {
            type: 'cloud_scheduler_job',
            labels: { job_id: 'sync-api-key-usage' },
          },
          timestamp: '2026-10-30T12:00:00Z',
          severity: 'INFO',
          jsonPayload: {
            '@type':
              'type.googleapis.com/google.cloud.scheduler.logging.AttemptStarted',
            url: 'https://auth-service-abc.a.run.app/auth/jobs/sync-api-key-usage',
            scheduledTime: '2026-10-30T11:59:50.531135Z',
          },
        },
        'shop',
      );
      expect(started).toMatchObject({
        source: 'sync-api-key-usage',
        kind: 'platform',
        level: 'info',
        message:
          'Run started (scheduled 2026-10-30 11:59:50): https://auth-service-abc.a.run.app/auth/jobs/sync-api-key-usage',
      });

      const finished = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/cloudscheduler.googleapis.com%2Fexecutions',
          resource: {
            type: 'cloud_scheduler_job',
            labels: { job_id: 'sync-api-key-usage' },
          },
          timestamp: '2026-10-30T12:00:01Z',
          severity: 'ERROR',
          httpRequest: { status: 500 },
          jsonPayload: {
            '@type':
              'type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished',
            status: 'INTERNAL',
            debugInfo:
              'URL_ERROR-ERROR_INTERNAL. Original HTTP response code number = 500',
          },
        },
        'shop',
      );
      expect(finished.message).toBe(
        'Run finished: 500 (URL_ERROR-ERROR_INTERNAL. Original HTTP response code number = 500)',
      );
      expect(finished.level).toBe('error');

      const succeeded = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/cloudscheduler.googleapis.com%2Fexecutions',
          resource: {
            type: 'cloud_scheduler_job',
            labels: { job_id: 'sync-api-key-usage' },
          },
          timestamp: '2026-10-30T12:00:01Z',
          severity: 'INFO',
          httpRequest: { status: 201 },
          jsonPayload: {
            '@type':
              'type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished',
            debugInfo: 'URL_CRAWLED. Original HTTP response code number = 201',
          },
        },
        'shop',
      );
      expect(succeeded.message).toBe('Run finished: 201');
    });
  });

  describe('Edge cases', () => {
    it('should read JSON output that is not ours with its own message and level', () => {
      const line = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/run.googleapis.com%2Fstdout',
          resource: RUN('auth-service'),
          timestamp: '2026-10-30T12:00:01Z',
          severity: 'INFO',
          jsonPayload: { message: 'hello' },
        },
        'shop',
      );
      expect(line).toMatchObject({
        kind: 'app',
        level: 'info',
        message: 'hello',
      });
    });

    it('should describe an audit log by its method', () => {
      const line = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/cloudaudit.googleapis.com%2Factivity',
          resource: RUN('auth-service'),
          timestamp: '2026-10-30T12:00:01Z',
          severity: 'NOTICE',
          protoPayload: {
            methodName: 'google.cloud.run.v2.Services.UpdateService',
          },
        },
        'shop',
      );
      expect(line).toMatchObject({
        kind: 'platform',
        level: 'info',
        message: 'google.cloud.run.v2.Services.UpdateService',
      });
    });

    it('should fall back to the payload when nothing else describes the line', () => {
      const line = normalizeGcpLogEntry(
        {
          logName: 'projects/p/logs/other',
          resource: { type: 'gce_instance', labels: {} },
          timestamp: '2026-10-30T12:00:01Z',
          jsonPayload: { a: 1 },
        },
        'shop',
      );
      expect(line).toMatchObject({
        source: 'gce_instance',
        kind: 'platform',
        message: '{"a":1}',
      });
      expect(line.level).toBeUndefined();
    });
  });
});
