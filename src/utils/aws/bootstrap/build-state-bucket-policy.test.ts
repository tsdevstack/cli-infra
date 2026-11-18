import { describe, it, expect } from '@rstest/core';
import { buildStateBucketPolicy } from './build-state-bucket-policy';

describe('buildStateBucketPolicy', () => {
  describe('Standard use cases', () => {
    it('should refuse every request without HTTPS on the bucket and its objects', () => {
      expect(
        JSON.parse(buildStateBucketPolicy('shop-terraform-state-123')),
      ).toEqual({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'DenyInsecureTransport',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [
              'arn:aws:s3:::shop-terraform-state-123',
              'arn:aws:s3:::shop-terraform-state-123/*',
            ],
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          },
        ],
      });
    });
  });

  describe('Edge cases', () => {
    it('should allow nothing (only one Deny statement)', () => {
      const policy = JSON.parse(buildStateBucketPolicy('b')) as {
        Statement: { Effect: string }[];
      };
      expect(policy.Statement.map((s) => s.Effect)).toEqual(['Deny']);
    });
  });
});
