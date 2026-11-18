import { describe, it, expect } from '@rstest/core';
import { planAwsLiveTailSessions } from './plan-aws-live-tail-sessions';
import type { AwsExistingLogGroup, AwsLogGroupRead } from './types';

function read(
  name: string,
  logGroupName: string,
  overrides: Partial<AwsLogGroupRead> = {},
): AwsLogGroupRead {
  return {
    source: { name, type: 'service' },
    logGroupName,
    region: 'eu-west-1',
    kind: 'app',
    format: 'app',
    ...overrides,
  };
}

function existing(
  ...groups: Array<[string, string, string?]>
): Map<string, AwsExistingLogGroup> {
  return new Map(
    groups.map(([region, name, logGroupClass]) => [
      `${region}/${name}`,
      {
        arn: `arn:aws:logs:${region}:123:log-group:${name}`,
        ...(logGroupClass && { logGroupClass }),
      },
    ]),
  );
}

describe('planAwsLiveTailSessions', () => {
  describe('Standard use cases', () => {
    it('should put the log groups of one region in one session, by ARN', () => {
      const reads = [
        read('auth-service', '/ecs/shop/auth-service'),
        read('kong', '/ecs/shop/kong'),
      ];

      const { sessions, notStandard } = planAwsLiveTailSessions(
        reads,
        existing(
          ['eu-west-1', '/ecs/shop/auth-service', 'STANDARD'],
          ['eu-west-1', '/ecs/shop/kong'],
        ),
      );

      expect(notStandard).toEqual([]);
      expect(sessions).toEqual([
        {
          region: 'eu-west-1',
          logGroups: [
            {
              name: '/ecs/shop/auth-service',
              arn: 'arn:aws:logs:eu-west-1:123:log-group:/ecs/shop/auth-service',
            },
            {
              name: '/ecs/shop/kong',
              arn: 'arn:aws:logs:eu-west-1:123:log-group:/ecs/shop/kong',
            },
          ],
          reads,
        },
      ]);
    });

    it('should give the WAF group in us-east-1 its own session', () => {
      const reads = [
        read('auth-service', '/ecs/shop/auth-service'),
        read('edge', 'aws-waf-logs-shop-dev', {
          region: 'us-east-1',
          kind: 'edge',
          format: 'waf',
        }),
      ];

      const { sessions } = planAwsLiveTailSessions(
        reads,
        existing(
          ['eu-west-1', '/ecs/shop/auth-service'],
          ['us-east-1', 'aws-waf-logs-shop-dev'],
        ),
      );

      expect(sessions.map((session) => session.region)).toEqual([
        'eu-west-1',
        'us-east-1',
      ]);
    });

    it('should split more than 10 log groups into sessions of 10', () => {
      const names = Array.from({ length: 12 }, (_, i) => `svc-${i}`);
      const reads = names.map((name) => read(name, `/ecs/shop/${name}`));

      const { sessions } = planAwsLiveTailSessions(
        reads,
        existing(
          ...names.map((name): [string, string] => [
            'eu-west-1',
            `/ecs/shop/${name}`,
          ]),
        ),
      );

      expect(sessions.map((session) => session.logGroups.length)).toEqual([
        10, 2,
      ]);
      expect(sessions[1].reads.map((r) => r.source.name)).toEqual([
        'svc-10',
        'svc-11',
      ]);
    });

    it('should list a log group shared by several sources once, with all its reads', () => {
      const group = '/aws/lambda/shop-job-invoker';
      const reads = [
        read('cleanup', group, {
          format: 'job',
          filterPattern: '"job=cleanup"',
        }),
        read('report', group, { format: 'job', filterPattern: '"job=report"' }),
      ];

      const { sessions } = planAwsLiveTailSessions(
        reads,
        existing(['eu-west-1', group]),
      );

      expect(sessions[0].logGroups).toHaveLength(1);
      expect(sessions[0].reads).toEqual(reads);
      expect(sessions[0].filterPattern).toBeUndefined();
    });

    it('should keep the filter pattern when every read has the same one', () => {
      const level = '{ $.level = "error" || $.level = "fatal" }';
      const reads = [
        read('auth-service', '/ecs/shop/auth-service', {
          filterPattern: level,
        }),
        read('kong', '/ecs/shop/kong', { filterPattern: level }),
      ];

      const { sessions } = planAwsLiveTailSessions(
        reads,
        existing(
          ['eu-west-1', '/ecs/shop/auth-service'],
          ['eu-west-1', '/ecs/shop/kong'],
        ),
      );

      expect(sessions[0].filterPattern).toBe(level);
    });
  });

  describe('Edge cases', () => {
    it('should leave out log groups that do not exist', () => {
      const reads = [
        read('migrate-auth-service', '/ecs/shop/migrate-auth-service'),
        read('migrate-auth-service', '/ecs/migrate-auth-service-migration'),
      ];

      const { sessions } = planAwsLiveTailSessions(
        reads,
        existing(['eu-west-1', '/ecs/shop/migrate-auth-service']),
      );

      expect(sessions).toHaveLength(1);
      expect(sessions[0].logGroups.map((group) => group.name)).toEqual([
        '/ecs/shop/migrate-auth-service',
      ]);
    });

    it('should leave out and name log groups outside the Standard class', () => {
      const reads = [read('auth-service', '/ecs/shop/auth-service')];

      const result = planAwsLiveTailSessions(
        reads,
        existing(['eu-west-1', '/ecs/shop/auth-service', 'INFREQUENT_ACCESS']),
      );

      expect(result).toEqual({
        sessions: [],
        notStandard: ['/ecs/shop/auth-service'],
      });
    });

    it('should plan nothing without reads', () => {
      expect(planAwsLiveTailSessions([], new Map())).toEqual({
        sessions: [],
        notStandard: [],
      });
    });
  });
});
