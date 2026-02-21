/**
 * Tests for get-other-environments
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { getOtherEnvironments } from './get-other-environments';
import type { AWSCommandContext } from '../commands/types';

// Mock context
rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    getAvailableEnvironments: rs.fn(),
    findProjectRoot: rs.fn(() => '/test/root'),
  })),
}));

describe('getOtherEnvironments', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return empty array when no other environments', async () => {
      const { getContext } = await import('../../../context');
      (getContext as ReturnType<typeof rs.fn>).mockReturnValue({
        getAvailableEnvironments: rs.fn(() => ['dev']),
        findProjectRoot: rs.fn(() => '/test/root'),
      });

      const ctx = { targetEnv: 'dev' } as AWSCommandContext;
      const result = getOtherEnvironments(ctx);

      expect(result).toEqual([]);
    });

    it('should filter out current environment', async () => {
      const { getContext } = await import('../../../context');
      (getContext as ReturnType<typeof rs.fn>).mockReturnValue({
        getAvailableEnvironments: rs.fn(() => ['dev', 'staging', 'prod']),
        findProjectRoot: rs.fn(() => '/test/root'),
      });

      const ctx = { targetEnv: 'dev' } as AWSCommandContext;
      const result = getOtherEnvironments(ctx);

      expect(result).toEqual(['staging', 'prod']);
      expect(result).not.toContain('dev');
    });

    it('should return empty array on error', async () => {
      const { getContext } = await import('../../../context');
      (getContext as ReturnType<typeof rs.fn>).mockReturnValue({
        getAvailableEnvironments: rs.fn(() => {
          throw new Error('Config not found');
        }),
        findProjectRoot: rs.fn(() => '/test/root'),
      });

      const ctx = { targetEnv: 'dev' } as AWSCommandContext;
      const result = getOtherEnvironments(ctx);

      expect(result).toEqual([]);
    });

    it('should handle all environments different from current', async () => {
      const { getContext } = await import('../../../context');
      (getContext as ReturnType<typeof rs.fn>).mockReturnValue({
        getAvailableEnvironments: rs.fn(() => [
          'dev',
          'test',
          'staging',
          'prod',
        ]),
        findProjectRoot: rs.fn(() => '/test/root'),
      });

      const ctx = { targetEnv: 'staging' } as AWSCommandContext;
      const result = getOtherEnvironments(ctx);

      expect(result).toEqual(['dev', 'test', 'prod']);
      expect(result).not.toContain('staging');
    });
  });
});
