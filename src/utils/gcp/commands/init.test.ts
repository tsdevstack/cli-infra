import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockCreateBucket = rs.fn();
rs.mock('../create-bucket', () => ({
  createBucket: (...args: unknown[]) => mockCreateBucket(...args),
}));

import { gcpInit } from './init';
import type { GCPCommandContext } from './types';

describe('gcpInit', () => {
  const mockContext: GCPCommandContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      project_id: 'gcp-project-123',
      region: 'us-central1',
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: 'key',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('bucket creation', () => {
    it('should create state bucket with correct name', async () => {
      mockCreateBucket.mockResolvedValue({ success: true, isNew: true });

      await gcpInit(mockContext);

      expect(mockCreateBucket).toHaveBeenCalledWith({
        bucketName: 'my-app-tf-state-gcp-project-123',
        credentials: mockContext.credentials,
        location: 'US',
        versioning: true,
        labels: {
          purpose: 'tf-state',
          environment: 'dev',
        },
      });
    });

    it('should log success when bucket is created', async () => {
      mockCreateBucket.mockResolvedValue({ success: true, isNew: true });

      await gcpInit(mockContext);

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Created bucket'),
      );
    });

    it('should log success when bucket already exists', async () => {
      mockCreateBucket.mockResolvedValue({ success: true, isNew: false });

      await gcpInit(mockContext);

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('already exists'),
      );
    });

    it('should throw when bucket creation fails', async () => {
      mockCreateBucket.mockResolvedValue({
        success: false,
        error: 'Permission denied',
      });

      await expect(gcpInit(mockContext)).rejects.toThrow(mocks.CliError);
    });
  });

  describe('logging', () => {
    it('should log bucket name at start', async () => {
      mockCreateBucket.mockResolvedValue({ success: true, isNew: true });

      await gcpInit(mockContext);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('my-app-tf-state-gcp-project-123'),
      );
    });

    it('should log next steps after success', async () => {
      mockCreateBucket.mockResolvedValue({ success: true, isNew: true });

      await gcpInit(mockContext);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Next steps'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('infra:generate'),
      );
    });
  });
});
