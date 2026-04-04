/**
 * Tests for disable-deletion-protection (AWS)
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { disableDeletionProtection } from './disable-deletion-protection';

// Mock AWS SDK
const mockSend = rs.fn();

rs.mock('@aws-sdk/client-rds', () => ({
  RDSClient: rs.fn().mockImplementation(() => ({ send: mockSend })),
  DescribeDBInstancesCommand: rs.fn().mockImplementation((input: unknown) => ({
    type: 'DescribeDBInstances',
    input,
  })),
  ModifyDBInstanceCommand: rs.fn().mockImplementation((input: unknown) => ({
    type: 'ModifyDBInstance',
    input,
  })),
}));

// Mock build-aws-client-config
rs.mock('./build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn().mockReturnValue({ region: 'us-east-1' }),
}));

// Mock context
rs.mock('../../context', () => ({
  getContext: () => ({
    isCIEnv: () => false,
  }),
}));

const baseOptions = {
  instanceIdentifier: 'test-project-db',
  credentials: {
    accountId: '123456789012',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    region: 'us-east-1',
  },
};

describe('disableDeletionProtection', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('when deletion protection is enabled', () => {
    it('should disable it and return success', async () => {
      mockSend
        .mockResolvedValueOnce({
          DBInstances: [{ DeletionProtection: true }],
        })
        .mockResolvedValueOnce({});

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('when deletion protection is already disabled', () => {
    it('should return success with wasAlreadyDisabled', async () => {
      mockSend.mockResolvedValueOnce({
        DBInstances: [{ DeletionProtection: false }],
      });

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('when instance does not exist', () => {
    it('should return success with wasAlreadyDisabled', async () => {
      mockSend.mockRejectedValueOnce({ name: 'DBInstanceNotFoundFault' });

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBe(true);
    });
  });

  describe('when no instances returned', () => {
    it('should return success with wasAlreadyDisabled', async () => {
      mockSend.mockResolvedValueOnce({
        DBInstances: [],
      });

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBe(true);
    });
  });

  describe('when API call fails', () => {
    it('should return failure with error message', async () => {
      mockSend.mockRejectedValueOnce({
        name: 'AccessDenied',
        message: 'Access denied',
      });

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });
});
