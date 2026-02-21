import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { buildAWSClientConfig } from './build-aws-client-config';

// Mock context
rs.mock('../../context', () => ({
  getContext: rs.fn(),
}));

import { getContext } from '../../context';

describe('buildAWSClientConfig', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('in CI environment', () => {
    beforeEach(() => {
      rs.mocked(getContext).mockReturnValue({
        isCIEnv: () => true,
      } as ReturnType<typeof getContext>);
    });

    it('should return config with only region', () => {
      const config = buildAWSClientConfig(mockCredentials);
      expect(config).toEqual({
        region: 'us-east-1',
      });
    });

    it('should not include credentials', () => {
      const config = buildAWSClientConfig(mockCredentials);
      expect(config.credentials).toBeUndefined();
    });
  });

  describe('in local environment', () => {
    beforeEach(() => {
      rs.mocked(getContext).mockReturnValue({
        isCIEnv: () => false,
      } as ReturnType<typeof getContext>);
    });

    it('should return config with region and credentials', () => {
      const config = buildAWSClientConfig(mockCredentials);
      expect(config).toEqual({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      });
    });

    it('should include explicit credentials', () => {
      const config = buildAWSClientConfig(mockCredentials);
      expect(config.credentials).toBeDefined();
      expect(config.credentials?.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(config.credentials?.secretAccessKey).toBe(
        'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      );
    });
  });

  describe('different regions', () => {
    beforeEach(() => {
      rs.mocked(getContext).mockReturnValue({
        isCIEnv: () => true,
      } as ReturnType<typeof getContext>);
    });

    it('should use region from credentials', () => {
      const euCreds = { ...mockCredentials, region: 'eu-west-1' };
      const config = buildAWSClientConfig(euCreds);
      expect(config.region).toBe('eu-west-1');
    });

    it('should support ap-southeast region', () => {
      const apCreds = { ...mockCredentials, region: 'ap-southeast-1' };
      const config = buildAWSClientConfig(apCreds);
      expect(config.region).toBe('ap-southeast-1');
    });
  });
});
