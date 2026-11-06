import { describe, it, expect } from '@rstest/core';
import { buildAwsLogGroupReads } from './build-aws-log-group-reads';
import type { LogSource } from '../../logs/types';

const SOURCES: LogSource[] = [
  { name: 'auth-service', type: 'service' },
  { name: 'kong', type: 'kong' },
  { name: 'migrate-auth-service', type: 'migration' },
  { name: 'cleanup-tokens', type: 'job' },
  { name: 'edge', type: 'edge' },
];

const PARAMS = { projectName: 'shop', targetEnv: 'dev', region: 'eu-west-1' };

describe('buildAwsLogGroupReads', () => {
  describe('Standard use cases', () => {
    it('should read each source from its log group', () => {
      expect(buildAwsLogGroupReads(SOURCES, PARAMS)).toEqual([
        {
          source: SOURCES[0],
          logGroupName: '/ecs/shop/auth-service',
          region: 'eu-west-1',
          kind: 'app',
          format: 'app',
        },
        {
          source: SOURCES[1],
          logGroupName: '/ecs/shop/kong',
          region: 'eu-west-1',
          kind: 'app',
          format: 'app',
        },
        {
          source: SOURCES[2],
          logGroupName: '/ecs/migrate-auth-service-migration',
          region: 'eu-west-1',
          kind: 'app',
          format: 'app',
        },
        {
          source: SOURCES[3],
          logGroupName: '/aws/lambda/shop-job-invoker',
          region: 'eu-west-1',
          kind: 'platform',
          format: 'job',
          filterPattern: '"job=cleanup-tokens"',
        },
        {
          source: SOURCES[4],
          logGroupName: 'aws-waf-logs-shop-dev',
          region: 'us-east-1',
          kind: 'edge',
          format: 'waf',
        },
      ]);
    });

    it('should filter JSON lines by level', () => {
      const [read] = buildAwsLogGroupReads([SOURCES[0]], {
        ...PARAMS,
        level: 'warn',
      });
      expect(read.filterPattern).toBe(
        '{ $.level = "warn" || $.level = "error" || $.level = "fatal" }',
      );
    });
  });

  describe('Edge cases', () => {
    it('should keep only the reads of the requested kind', () => {
      expect(
        buildAwsLogGroupReads(SOURCES, { ...PARAMS, kind: 'edge' }).map(
          (read) => read.source.name,
        ),
      ).toEqual(['edge']);
      expect(
        buildAwsLogGroupReads(SOURCES, { ...PARAMS, kind: 'platform' }).map(
          (read) => read.source.name,
        ),
      ).toEqual(['cleanup-tokens']);
    });

    it('should count pino trace lines as debug', () => {
      const [read] = buildAwsLogGroupReads([SOURCES[0]], {
        ...PARAMS,
        level: 'debug',
      });
      expect(read.filterPattern).toContain('$.level = "trace"');
    });

    it('should not add a level filter to job or edge reads', () => {
      const reads = buildAwsLogGroupReads([SOURCES[3], SOURCES[4]], {
        ...PARAMS,
        level: 'error',
      });
      expect(reads[0].filterPattern).toBe('"job=cleanup-tokens"');
      expect(reads[1].filterPattern).toBeUndefined();
    });

    it('should read a job by the key its schedule passes (service and name)', () => {
      const [read] = buildAwsLogGroupReads(
        [{ name: 'cleanup-tokens', type: 'job', service: 'auth-service' }],
        PARAMS,
      );
      expect(read.filterPattern).toBe('"job=auth-service-cleanup-tokens"');
    });
  });
});
