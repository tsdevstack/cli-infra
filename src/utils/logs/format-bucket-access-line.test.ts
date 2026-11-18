import { describe, it, expect } from '@rstest/core';
import { formatBucketAccessLine } from './format-bucket-access-line';

describe('formatBucketAccessLine', () => {
  describe('Standard use cases', () => {
    it('should name the operation, the object, who and from where', () => {
      expect(
        formatBucketAccessLine({
          operation: 'GetObject',
          object: 'avatars/u1.png',
          principal: 'shop-auth-service-task',
          ip: '203.0.113.5',
        }),
      ).toBe(
        'GetObject avatars/u1.png by shop-auth-service-task from 203.0.113.5',
      );
    });

    it('should put the error before who, when the access failed', () => {
      expect(
        formatBucketAccessLine({
          operation: 'GetObject',
          object: 'avatars/u1.png',
          error: 'AccessDenied',
          principal: 'shop-auth-service-task',
        }),
      ).toBe('GetObject avatars/u1.png AccessDenied by shop-auth-service-task');
    });
  });

  describe('Edge cases', () => {
    it('should name the bucket itself for a list', () => {
      expect(formatBucketAccessLine({ operation: 'ListObjects' })).toBe(
        'ListObjects (bucket)',
      );
    });
  });
});
