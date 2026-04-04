/**
 * Tests for show-resource-warning
 */

import { describe, it, expect, rs } from '@rstest/core';
import { showResourceWarning } from './show-resource-warning';
import type { DiscoveredResources } from '../discovery';

describe('showResourceWarning', () => {
  const mockLogger = {
    newline: rs.fn(),
    warn: rs.fn(),
    info: rs.fn(),
  };

  describe('Standard use cases', () => {
    it('should show warning for ECS service', () => {
      const discovered: DiscoveredResources = {
        ecsService: true,

        spaBucket: false,
        spaBucketName: '',
        secrets: [],
        inferredType: 'backend',
      };

      showResourceWarning({
        serviceName: 'test-service',
        discovered,
        coupledWorkers: [],
        targetEnv: 'dev',
        dryRun: false,
        logger: mockLogger,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('will PERMANENTLY DELETE'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('ECS Service'),
      );
    });

    it('should show dry run message', () => {
      const discovered: DiscoveredResources = {
        ecsService: true,

        spaBucket: false,
        spaBucketName: '',
        secrets: [],
        inferredType: 'backend',
      };

      showResourceWarning({
        serviceName: 'test-service',
        discovered,
        coupledWorkers: [],
        targetEnv: 'dev',
        dryRun: true,
        logger: mockLogger,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('WOULD DELETE'),
      );
    });

    it('should show coupled workers', () => {
      const discovered: DiscoveredResources = {
        ecsService: true,

        spaBucket: false,
        spaBucketName: '',
        secrets: [],
        inferredType: 'backend',
      };

      showResourceWarning({
        serviceName: 'test-service',
        discovered,
        coupledWorkers: ['test-worker-1', 'test-worker-2'],
        targetEnv: 'dev',
        dryRun: false,
        logger: mockLogger,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Coupled workers'),
      );
    });

    it('should show SPA bucket', () => {
      const discovered: DiscoveredResources = {
        ecsService: false,

        spaBucket: true,
        spaBucketName: 'my-spa-bucket',
        secrets: [],
        inferredType: 'spa',
      };

      showResourceWarning({
        serviceName: 'test-service',
        discovered,
        coupledWorkers: [],
        targetEnv: 'dev',
        dryRun: false,
        logger: mockLogger,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('S3 Bucket'),
      );
    });

    it('should show secrets count', () => {
      const discovered: DiscoveredResources = {
        ecsService: true,

        spaBucket: false,
        spaBucketName: '',
        secrets: ['secret1', 'secret2', 'secret3'],
        inferredType: 'backend',
      };

      showResourceWarning({
        serviceName: 'test-service',
        discovered,
        coupledWorkers: [],
        targetEnv: 'dev',
        dryRun: false,
        logger: mockLogger,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('3 found'),
      );
    });
  });
});
