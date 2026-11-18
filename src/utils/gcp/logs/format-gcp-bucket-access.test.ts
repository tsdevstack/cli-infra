import { describe, it, expect } from '@rstest/core';
import { formatGcpBucketAccess } from './format-gcp-bucket-access';

function entry(payload: Record<string, unknown>) {
  return { protoPayload: payload };
}

describe('formatGcpBucketAccess', () => {
  describe('Standard use cases', () => {
    it('should show a write with who and from where', () => {
      expect(
        formatGcpBucketAccess(
          entry({
            methodName: 'storage.objects.create',
            resourceName: 'projects/_/buckets/b/objects/docs/a.pdf',
            authenticationInfo: {
              principalEmail: 'svc@p.iam.gserviceaccount.com',
            },
            requestMetadata: { callerIp: '2001:db8::1' },
          }),
        ),
      ).toEqual({
        level: 'info',
        message:
          'storage.objects.create docs/a.pdf by svc@p.iam.gserviceaccount.com from 2001:db8::1',
      });
    });

    it('should warn on a refused access, with its message', () => {
      expect(
        formatGcpBucketAccess(
          entry({
            methodName: 'storage.objects.get',
            resourceName: 'projects/_/buckets/b/objects/a.png',
            status: { code: 7, message: 'PERMISSION_DENIED' },
          }),
        ),
      ).toEqual({
        level: 'warn',
        message: 'storage.objects.get a.png PERMISSION_DENIED',
      });
    });

    it('should be an error when Google failed on its side', () => {
      expect(
        formatGcpBucketAccess(
          entry({ methodName: 'storage.objects.get', status: { code: 14 } }),
        ),
      ).toEqual({
        level: 'error',
        message: 'storage.objects.get (bucket) code 14',
      });
    });
  });

  describe('Edge cases', () => {
    it('should name the bucket itself for a list', () => {
      expect(
        formatGcpBucketAccess(
          entry({
            methodName: 'storage.objects.list',
            resourceName: 'projects/_/buckets/b',
          }),
        ).message,
      ).toBe('storage.objects.list (bucket)');
    });

    it('should cope with an entry without a payload', () => {
      expect(formatGcpBucketAccess({})).toEqual({
        level: 'info',
        message: 'unknown (bucket)',
      });
    });
  });
});
