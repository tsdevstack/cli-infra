/**
 * Tests for discover-coupled-workers
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

// Create mock functions in hoisted scope
const { mockLoadFrameworkConfig, mockGetEcsService } = rs.hoisted(() => ({
  mockLoadFrameworkConfig: rs.fn(),
  mockGetEcsService: rs.fn(),
}));

// Mock dependencies with shared context
rs.mock('../../../context', () => ({
  getContext: () => ({
    loadFrameworkConfig: mockLoadFrameworkConfig,
  }),
}));

rs.mock('./get-ecs-service', () => ({
  getEcsService: mockGetEcsService,
}));

import { discoverCoupledWorkers } from './discover-coupled-workers';

describe('discoverCoupledWorkers', () => {
  const mockCredentials: AWSCredentials = {
    accountId: '123456789012',
    region: 'us-east-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return empty array when no workers are configured', async () => {
      mockLoadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project', version: '1.0.0' },
        services: [
          {
            name: 'test-service',
            type: 'nestjs',
            port: 3000,
            hasDatabase: false,
          },
        ],
      } as never);

      const result = await discoverCoupledWorkers({
        serviceName: 'test-service',
        projectName: 'test-project',
        targetEnv: 'dev',
        credentials: mockCredentials,
      });

      expect(result).toEqual([]);
    });

    it('should return empty array when workers exist but none are coupled to service', async () => {
      mockLoadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project', version: '1.0.0' },
        services: [
          {
            name: 'test-service',
            type: 'nestjs',
            port: 3000,
            hasDatabase: false,
          },
          {
            name: 'other-worker',
            type: 'worker',
            baseService: 'other-service',
          },
        ],
      } as never);

      const result = await discoverCoupledWorkers({
        serviceName: 'test-service',
        projectName: 'test-project',
        targetEnv: 'dev',
        credentials: mockCredentials,
      });

      expect(result).toEqual([]);
    });

    it('should return coupled workers that exist in ECS', async () => {
      mockLoadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project', version: '1.0.0' },
        services: [
          {
            name: 'test-service',
            type: 'nestjs',
            port: 3000,
            hasDatabase: false,
          },
          {
            name: 'test-worker',
            type: 'worker',
            baseService: 'test-service',
          },
        ],
      } as never);

      mockGetEcsService.mockResolvedValue({
        service: { exists: true },
      } as never);

      const result = await discoverCoupledWorkers({
        serviceName: 'test-service',
        projectName: 'test-project',
        targetEnv: 'dev',
        credentials: mockCredentials,
      });

      expect(result).toEqual(['test-worker']);
      expect(mockGetEcsService).toHaveBeenCalledWith({
        clusterName: 'test-project-cluster',
        serviceName: 'test-worker',
        credentials: mockCredentials,
      });
    });

    it('should filter out workers that do not exist in ECS', async () => {
      mockLoadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project', version: '1.0.0' },
        services: [
          {
            name: 'test-service',
            type: 'nestjs',
            port: 3000,
            hasDatabase: false,
          },
          {
            name: 'test-worker-1',
            type: 'worker',
            baseService: 'test-service',
          },
          {
            name: 'test-worker-2',
            type: 'worker',
            baseService: 'test-service',
          },
        ],
      } as never);

      mockGetEcsService
        .mockResolvedValueOnce({ service: { exists: true } } as never) // test-worker-1 exists
        .mockResolvedValueOnce({ service: { exists: false } } as never); // test-worker-2 does not exist

      const result = await discoverCoupledWorkers({
        serviceName: 'test-service',
        projectName: 'test-project',
        targetEnv: 'dev',
        credentials: mockCredentials,
      });

      expect(result).toEqual(['test-worker-1']);
    });
  });

  describe('Edge cases', () => {
    it('should return empty array when config cannot be loaded', async () => {
      mockLoadFrameworkConfig.mockImplementation(() => {
        throw new Error('Config not found');
      });

      const result = await discoverCoupledWorkers({
        serviceName: 'test-service',
        projectName: 'test-project',
        targetEnv: 'dev',
        credentials: mockCredentials,
      });

      expect(result).toEqual([]);
    });

    it('should handle ECS API errors gracefully', async () => {
      mockLoadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project', version: '1.0.0' },
        services: [
          {
            name: 'test-service',
            type: 'nestjs',
            port: 3000,
            hasDatabase: false,
          },
          {
            name: 'test-worker',
            type: 'worker',
            baseService: 'test-service',
          },
        ],
      } as never);

      mockGetEcsService.mockRejectedValue(new Error('ECS API error'));

      // Should propagate ECS API errors
      await expect(
        discoverCoupledWorkers({
          serviceName: 'test-service',
          projectName: 'test-project',
          targetEnv: 'dev',
          credentials: mockCredentials,
        }),
      ).rejects.toThrow('ECS API error');
    });
  });
});
