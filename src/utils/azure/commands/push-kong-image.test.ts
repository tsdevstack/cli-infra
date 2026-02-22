/**
 * Tests for push-kong-image
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('@tsdevstack/infra-core', () => ({
  configureAcrAuth: rs.fn(),
}));

import { pushAzureKongImage } from './push-kong-image';
import { execSync } from 'node:child_process';
import { configureAcrAuth } from '@tsdevstack/infra-core';

const testCredentials = {
  subscriptionId: 'sub-123',
  tenantId: 'tenant-456',
  clientId: 'client-789',
  clientSecret: 'secret-abc',
  location: 'eastus',
};

describe('pushAzureKongImage', () => {
  beforeEach(() => {
    rs.resetAllMocks();
    rs.mocked(configureAcrAuth).mockResolvedValue();
  });

  describe('Standard use cases', () => {
    it('should configure ACR auth before pushing', async () => {
      await pushAzureKongImage(
        'myacr.azurecr.io/kong:abc123',
        'myacr.azurecr.io',
        testCredentials,
      );

      expect(configureAcrAuth).toHaveBeenCalledWith(
        expect.anything(),
        testCredentials,
        'myacr.azurecr.io',
      );
    });

    it('should push image with docker push', async () => {
      await pushAzureKongImage(
        'myacr.azurecr.io/kong:abc123',
        'myacr.azurecr.io',
        testCredentials,
      );

      expect(execSync).toHaveBeenCalledWith(
        'docker push myacr.azurecr.io/kong:abc123',
        { stdio: 'inherit' },
      );
    });

    it('should log success after push', async () => {
      await pushAzureKongImage(
        'myacr.azurecr.io/kong:v1',
        'myacr.azurecr.io',
        testCredentials,
      );

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('myacr.azurecr.io/kong:v1'),
      );
    });
  });

  describe('Error cases', () => {
    it('should propagate ACR auth errors', async () => {
      rs.mocked(configureAcrAuth).mockRejectedValue(new Error('Auth failed'));

      await expect(
        pushAzureKongImage(
          'myacr.azurecr.io/kong:v1',
          'myacr.azurecr.io',
          testCredentials,
        ),
      ).rejects.toThrow('Auth failed');
    });

    it('should propagate docker push errors', async () => {
      rs.mocked(execSync).mockImplementation(() => {
        throw new Error('push failed');
      });

      await expect(
        pushAzureKongImage(
          'myacr.azurecr.io/kong:v1',
          'myacr.azurecr.io',
          testCredentials,
        ),
      ).rejects.toThrow('push failed');
    });
  });
});
