/**
 * Tests for disable-alb-deletion-protection (AWS)
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { disableAlbDeletionProtection } from './disable-alb-deletion-protection';

// Mock AWS SDK
const mockSend = rs.fn();

rs.mock('@aws-sdk/client-elastic-load-balancing-v2', () => ({
  ElasticLoadBalancingV2Client: rs
    .fn()
    .mockImplementation(() => ({ send: mockSend })),
  DescribeLoadBalancersCommand: rs
    .fn()
    .mockImplementation((input: unknown) => ({
      type: 'DescribeLoadBalancers',
      input,
    })),
  DescribeLoadBalancerAttributesCommand: rs
    .fn()
    .mockImplementation((input: unknown) => ({
      type: 'DescribeLoadBalancerAttributes',
      input,
    })),
  ModifyLoadBalancerAttributesCommand: rs
    .fn()
    .mockImplementation((input: unknown) => ({
      type: 'ModifyLoadBalancerAttributes',
      input,
    })),
}));

// Mock build-aws-client-config
rs.mock('./build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn().mockReturnValue({ region: 'us-east-1' }),
}));

const loadBalancerArn =
  'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/test-project-alb/abc123';

const baseOptions = {
  loadBalancerName: 'test-project-alb',
  credentials: {
    accountId: '123456789012',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    region: 'us-east-1',
  },
};

describe('disableAlbDeletionProtection', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('when deletion protection is enabled', () => {
    it('should disable it and return success', async () => {
      mockSend
        .mockResolvedValueOnce({
          LoadBalancers: [{ LoadBalancerArn: loadBalancerArn }],
        })
        .mockResolvedValueOnce({
          Attributes: [
            { Key: 'access_logs.s3.enabled', Value: 'true' },
            { Key: 'deletion_protection.enabled', Value: 'true' },
          ],
        })
        .mockResolvedValueOnce({});

      const result = await disableAlbDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(mockSend.mock.calls[0][0]).toEqual({
        type: 'DescribeLoadBalancers',
        input: { Names: ['test-project-alb'] },
      });
      expect(mockSend.mock.calls[2][0]).toEqual({
        type: 'ModifyLoadBalancerAttributes',
        input: {
          LoadBalancerArn: loadBalancerArn,
          Attributes: [{ Key: 'deletion_protection.enabled', Value: 'false' }],
        },
      });
    });
  });

  describe('when deletion protection is already disabled', () => {
    it('should return success with wasAlreadyDisabled', async () => {
      mockSend
        .mockResolvedValueOnce({
          LoadBalancers: [{ LoadBalancerArn: loadBalancerArn }],
        })
        .mockResolvedValueOnce({
          Attributes: [{ Key: 'deletion_protection.enabled', Value: 'false' }],
        });

      const result = await disableAlbDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('when the load balancer does not exist', () => {
    it('should return success when AWS reports it as not found', async () => {
      const error = new Error('One or more load balancers not found');
      (error as Error & { name: string }).name =
        'LoadBalancerNotFoundException';
      mockSend.mockRejectedValueOnce(error);

      const result = await disableAlbDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBe(true);
    });

    it('should return success when the response has no load balancer', async () => {
      mockSend.mockResolvedValueOnce({ LoadBalancers: [] });

      const result = await disableAlbDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('when an API call fails', () => {
    it('should return the error', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access denied'));

      const result = await disableAlbDeletionProtection(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });
});
