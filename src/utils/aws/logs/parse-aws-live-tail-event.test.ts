import { describe, it, expect } from '@rstest/core';
import { parseAwsLiveTailEvent } from './parse-aws-live-tail-event';
import type { AwsLiveTailSession, AwsLogGroupRead } from './types';

const APP_GROUP = '/ecs/shop/auth-service';
const JOB_GROUP = '/aws/lambda/shop-job-invoker';
const TRAIL_GROUP = '/aws/cloudtrail/shop-storage-access';
const arn = (name: string): string =>
  `arn:aws:logs:eu-west-1:123:log-group:${name}`;

const reads: AwsLogGroupRead[] = [
  {
    source: { name: 'auth-service', type: 'service' },
    logGroupName: APP_GROUP,
    region: 'eu-west-1',
    kind: 'app',
    format: 'app',
  },
  {
    source: { name: 'cleanup', type: 'job' },
    logGroupName: JOB_GROUP,
    region: 'eu-west-1',
    kind: 'platform',
    format: 'job',
    filterPattern: '"job=cleanup"',
  },
  {
    source: { name: 'bucket-uploads', type: 'bucket', bucket: 'uploads' },
    logGroupName: TRAIL_GROUP,
    region: 'eu-west-1',
    kind: 'platform',
    format: 'bucket',
    bucketName: 'shop-uploads-dev-123',
  },
  {
    source: { name: 'bucket-avatars', type: 'bucket', bucket: 'avatars' },
    logGroupName: TRAIL_GROUP,
    region: 'eu-west-1',
    kind: 'platform',
    format: 'bucket',
    bucketName: 'shop-avatars-dev-123',
  },
];

const session: AwsLiveTailSession = {
  region: 'eu-west-1',
  logGroups: [APP_GROUP, JOB_GROUP, TRAIL_GROUP].map((name) => ({
    name,
    arn: arn(name),
  })),
  reads,
};

const TIME = Date.UTC(2026, 10, 10, 12, 0, 1);

describe('parseAwsLiveTailEvent', () => {
  describe('Standard use cases', () => {
    it("should turn an app line into its source's line, the group named by ARN", () => {
      const entries = parseAwsLiveTailEvent(
        {
          logGroupIdentifier: arn(APP_GROUP),
          logStreamName: 'ecs/auth-service/abc',
          timestamp: TIME,
          message: JSON.stringify({ level: 'error', msg: 'Payment failed' }),
        },
        session,
      );

      expect(entries).toMatchObject([
        {
          time: '2026-11-10T12:00:01.000Z',
          source: 'auth-service',
          kind: 'app',
          level: 'error',
          message: 'Payment failed',
        },
      ]);
    });

    it.each([
      ['its name', APP_GROUP],
      ['the account and its name', `123:${APP_GROUP}`],
    ])('should match the group by %s too', (_shape, identifier) => {
      expect(
        parseAwsLiveTailEvent(
          { logGroupIdentifier: identifier, timestamp: TIME, message: 'ready' },
          session,
        ),
      ).toHaveLength(1);
    });

    it("should keep only the job's own lines", () => {
      const line = (body: string) => ({
        logGroupIdentifier: arn(JOB_GROUP),
        timestamp: TIME,
        message: `2026-11-10T12:00:01.000Z\treq\tINFO\t${body}`,
      });

      expect(
        parseAwsLiveTailEvent(line('job=cleanup Calling POST /x'), session),
      ).toMatchObject([{ source: 'cleanup', message: 'Calling POST /x' }]);
      expect(
        parseAwsLiveTailEvent(line('job=report Calling POST /y'), session),
      ).toEqual([]);
    });

    it("should give a bucket's event to that bucket only", () => {
      const entries = parseAwsLiveTailEvent(
        {
          logGroupIdentifier: arn(TRAIL_GROUP),
          timestamp: TIME,
          message: JSON.stringify({
            eventName: 'GetObject',
            requestParameters: {
              bucketName: 'shop-avatars-dev-123',
              key: 'u1.png',
            },
          }),
        },
        session,
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        source: 'bucket-avatars',
        kind: 'platform',
      });
      expect(entries[0].message).toContain('GetObject u1.png');
    });
  });

  describe('Edge cases', () => {
    it('should drop events of a log group the session does not hold', () => {
      expect(
        parseAwsLiveTailEvent(
          {
            logGroupIdentifier: arn('/ecs/shop/other'),
            timestamp: TIME,
            message: 'x',
          },
          session,
        ),
      ).toEqual([]);
      expect(
        parseAwsLiveTailEvent(
          { logGroupIdentifier: '', timestamp: TIME, message: 'x' },
          session,
        ),
      ).toEqual([]);
    });

    it('should drop trail lines that are not JSON or name no selected bucket', () => {
      expect(
        parseAwsLiveTailEvent(
          {
            logGroupIdentifier: arn(TRAIL_GROUP),
            timestamp: TIME,
            message: 'not json',
          },
          session,
        ),
      ).toEqual([]);
      expect(
        parseAwsLiveTailEvent(
          {
            logGroupIdentifier: arn(TRAIL_GROUP),
            timestamp: TIME,
            message: JSON.stringify({
              requestParameters: { bucketName: 'someone-else' },
            }),
          },
          session,
        ),
      ).toEqual([]);
    });
  });
});
