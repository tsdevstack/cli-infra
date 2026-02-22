/**
 * Tests for upgrade-frontdoor-sku
 */

import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockGetToken = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({
    getToken: mockGetToken,
  })),
}));

const mockFetch = rs.fn();
rs.stubGlobal('fetch', mockFetch);

import { upgradeFrontdoorSku } from './upgrade-frontdoor-sku';

const baseParams = {
  credentials: {
    subscriptionId: 'sub-123',
    tenantId: 'tenant-456',
    clientId: 'client-789',
    clientSecret: 'secret-abc',
    location: 'eastus',
  },
  projectName: 'my-app',
  targetEnv: 'dev',
  frontdoorPremium: true,
};

const baseUrl =
  'https://management.azure.com/subscriptions/sub-123/resourceGroups/my-app-dev-rg/providers/Microsoft.Cdn/profiles/my-app-dev-frontdoor';

describe('upgradeFrontdoorSku', () => {
  beforeEach(() => {
    rs.useFakeTimers();
    rs.resetAllMocks();
    mockGetToken.mockResolvedValue({ token: 'test-token' });
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  describe('Standard use cases', () => {
    it('should upgrade Standard to Premium', async () => {
      // GET profile — Standard SKU
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      // POST upgrade — 202 Accepted with async operation URL
      const asyncOpUrl = 'https://management.azure.com/operations/upgrade-123';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Map([['Azure-AsyncOperation', asyncOpUrl]]),
      });

      // Poll — Succeeded
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'Succeeded' }),
      });

      const promise = upgradeFrontdoorSku(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      // Verify GET call
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}?api-version=2024-02-01`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        }),
      );

      // Verify POST upgrade call
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/upgrade?api-version=2024-02-01`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('wafMappingList'),
        }),
      );

      // Verify WAF mapping in body
      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body as string) as {
        wafMappingList: Array<{
          securityPolicyName: string;
          changeToWafPolicy: { id: string };
        }>;
      };
      expect(body.wafMappingList[0].securityPolicyName).toBe(
        'my-app-dev-security',
      );
      expect(body.wafMappingList[0].changeToWafPolicy.id).toContain(
        'myappdevwaf',
      );

      expect(mocks.logger.success).toHaveBeenCalledWith(
        'Front Door upgraded to Premium',
      );
    });

    it('should skip when SKU already matches (Premium requested, already Premium)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Premium_AzureFrontDoor' } }),
      });

      await upgradeFrontdoorSku(baseParams);

      // Only one fetch call (GET profile), no upgrade POST
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should skip when SKU already matches (Standard requested, already Standard)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      await upgradeFrontdoorSku({ ...baseParams, frontdoorPremium: false });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle immediate 200 response (no LRO)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await upgradeFrontdoorSku(baseParams);

      expect(mocks.logger.success).toHaveBeenCalledWith(
        'Front Door upgraded to Premium',
      );
    });

    it('should handle 202 with Location header (no Azure-AsyncOperation)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      const locationUrl = 'https://management.azure.com/operations/loc-123';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Map([['Location', locationUrl]]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'Succeeded' }),
      });

      const promise = upgradeFrontdoorSku(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      // Third call should use Location URL
      expect(mockFetch).toHaveBeenCalledWith(
        locationUrl,
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        }),
      );
    });
  });

  describe('Fresh deploy (profile does not exist)', () => {
    it('should skip when profile returns 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await upgradeFrontdoorSku(baseParams);

      // Only one fetch call (GET profile), no upgrade
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Downgrade prevention', () => {
    it('should throw CliError when attempting Premium to Standard downgrade', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Premium_AzureFrontDoor' } }),
      });

      await expect(
        upgradeFrontdoorSku({ ...baseParams, frontdoorPremium: false }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('Error handling', () => {
    it('should throw when GET profile fails with non-404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      await expect(upgradeFrontdoorSku(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when POST upgrade fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(upgradeFrontdoorSku(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when LRO reports Failed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Map([
          [
            'Azure-AsyncOperation',
            'https://management.azure.com/operations/op-1',
          ],
        ]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'Failed',
          error: { message: 'Upgrade failed due to conflict' },
        }),
      });

      const promise = upgradeFrontdoorSku(baseParams);
      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const rejection = expect(promise).rejects.toThrow(mocks.CliError);
      await rs.advanceTimersByTimeAsync(15_000);
      await rejection;
    });

    it('should throw when LRO reports Canceled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Map([
          [
            'Azure-AsyncOperation',
            'https://management.azure.com/operations/op-1',
          ],
        ]),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'Canceled' }),
      });

      const promise = upgradeFrontdoorSku(baseParams);
      const rejection = expect(promise).rejects.toThrow(mocks.CliError);
      await rs.advanceTimersByTimeAsync(15_000);
      await rejection;
    });

    it('should throw on LRO polling timeout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Map([
          [
            'Azure-AsyncOperation',
            'https://management.azure.com/operations/op-1',
          ],
        ]),
      });

      // All 40 poll attempts return InProgress
      for (let i = 0; i < 40; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'InProgress' }),
        });
      }

      const promise = upgradeFrontdoorSku(baseParams);
      const rejection = expect(promise).rejects.toThrow(mocks.CliError);
      // Advance through all 40 polling intervals (40 * 15s = 600s = 10min)
      for (let i = 0; i < 40; i++) {
        await rs.advanceTimersByTimeAsync(15_000);
      }
      await rejection;
    });

    it('should continue polling when individual poll request fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Map([
          [
            'Azure-AsyncOperation',
            'https://management.azure.com/operations/op-1',
          ],
        ]),
      });

      // First poll fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Second poll succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'Succeeded' }),
      });

      const promise = upgradeFrontdoorSku(baseParams);
      await rs.advanceTimersByTimeAsync(15_000); // First poll (fails)
      await rs.advanceTimersByTimeAsync(15_000); // Second poll (succeeds)
      await promise;

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Poll attempt 1/40 failed'),
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        'Front Door upgraded to Premium',
      );
    });

    it('should handle 202 with no polling URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Map(),
      });

      const promise = upgradeFrontdoorSku(baseParams);
      await rs.advanceTimersByTimeAsync(60_000);
      await promise;

      expect(mocks.logger.success).toHaveBeenCalledWith(
        'Front Door upgrade to Premium initiated',
      );
    });
  });

  describe('Naming conventions', () => {
    it('should strip hyphens from project name in WAF policy name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sku: { name: 'Standard_AzureFrontDoor' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await upgradeFrontdoorSku({
        ...baseParams,
        projectName: 'my-cool-app',
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body as string) as {
        wafMappingList: Array<{
          changeToWafPolicy: { id: string };
        }>;
      };
      expect(body.wafMappingList[0].changeToWafPolicy.id).toContain(
        'mycoolappdevwaf',
      );
    });

    it('should use correct resource group naming', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await upgradeFrontdoorSku({
        ...baseParams,
        projectName: 'my-app',
        targetEnv: 'prod',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('my-app-prod-rg'),
        expect.anything(),
      );
    });
  });
});
