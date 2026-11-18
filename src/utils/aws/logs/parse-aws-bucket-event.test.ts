import { describe, it, expect } from '@rstest/core';
import { parseAwsBucketEvent } from './parse-aws-bucket-event';
import type { LogSource } from '../../logs/types';

const SOURCE: LogSource = {
  name: 'bucket-uploads',
  type: 'bucket',
  bucket: 'uploads',
};

function event(record: Record<string, unknown>) {
  return {
    timestamp: Date.UTC(2026, 10, 9, 12),
    message: JSON.stringify(record),
  };
}

const TASK_ROLE = {
  type: 'AssumedRole',
  arn: 'arn:aws:sts::123456789012:assumed-role/shop-auth-service-task/abc',
  sessionContext: { sessionIssuer: { userName: 'shop-auth-service-task' } },
};

describe('parseAwsBucketEvent', () => {
  describe('Standard use cases', () => {
    it('should show the operation, the object, the role and the address', () => {
      expect(
        parseAwsBucketEvent(
          event({
            eventName: 'GetObject',
            requestParameters: {
              bucketName: 'shop-uploads-dev-1',
              key: 'avatars/u1.png',
            },
            userIdentity: TASK_ROLE,
            sourceIPAddress: '203.0.113.5',
          }),
          SOURCE,
        ),
      ).toMatchObject({
        time: '2026-11-09T12:00:00.000Z',
        source: 'bucket-uploads',
        kind: 'platform',
        level: 'info',
        message:
          'GetObject avatars/u1.png by shop-auth-service-task from 203.0.113.5',
      });
    });

    it('should warn on a refused access, with its error', () => {
      const entry = parseAwsBucketEvent(
        event({
          eventName: 'PutObject',
          errorCode: 'AccessDenied',
          requestParameters: { key: 'a.txt' },
          userIdentity: TASK_ROLE,
        }),
        SOURCE,
      );
      expect(entry.level).toBe('warn');
      expect(entry.message).toBe(
        'PutObject a.txt AccessDenied by shop-auth-service-task',
      );
    });

    it('should be an error when S3 failed on its side', () => {
      expect(
        parseAwsBucketEvent(
          event({ eventName: 'GetObject', errorCode: 'InternalError' }),
          SOURCE,
        ).level,
      ).toBe('error');
    });
  });

  describe('Time', () => {
    it("should be the request's time, not CloudTrail's delivery", () => {
      expect(
        parseAwsBucketEvent(
          event({ eventName: 'GetObject', eventTime: '2026-11-09T11:58:30Z' }),
          SOURCE,
        ).time,
      ).toBe('2026-11-09T11:58:30.000Z');
    });

    it.each([
      ['no eventTime', {}],
      ['an eventTime that is not a time', { eventTime: 'soon' }],
    ])('should fall back to the delivery with %s', (_, extra) => {
      expect(
        parseAwsBucketEvent(event({ eventName: 'GetObject', ...extra }), SOURCE)
          .time,
      ).toBe('2026-11-09T12:00:00.000Z');
    });
  });

  describe('Edge cases', () => {
    it("should name an identity that isn't a role session by its ARN, else its type", () => {
      expect(
        parseAwsBucketEvent(
          event({
            eventName: 'DeleteObject',
            requestParameters: { key: 'x' },
            userIdentity: {
              type: 'IAMUser',
              arn: 'arn:aws:iam::1:user/deploy',
            },
          }),
          SOURCE,
        ).message,
      ).toBe('DeleteObject x by arn:aws:iam::1:user/deploy');
      expect(
        parseAwsBucketEvent(
          event({
            eventName: 'GetObject',
            userIdentity: { type: 'AWSService' },
          }),
          SOURCE,
        ).message,
      ).toBe('GetObject (bucket) by AWSService');
    });

    it('should keep a line that is not JSON as it is', () => {
      expect(
        parseAwsBucketEvent({ timestamp: 0, message: 'not json' }, SOURCE),
      ).toMatchObject({ message: 'not json', kind: 'platform' });
    });
  });
});
