/**
 * Tests for lock-down-public-access
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

import { lockDownPublicAccess } from './lock-down-public-access';

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
  appServiceNames: ['my-app-dev-kong', 'my-app-dev-frontend'],
  resourceGroupName: 'my-app-dev-rg',
};

const peBaseUrl = (appName: string): string =>
  `https://management.azure.com/subscriptions/sub-123/resourceGroups/my-app-dev-rg/providers/Microsoft.Web/sites/${appName}/privateEndpointConnections`;

const appServiceBaseUrl =
  'https://management.azure.com/subscriptions/sub-123/resourceGroups/my-app-dev-rg/providers/Microsoft.Web/sites';

function mockPeListResponse(
  connections: Array<{ name: string; status: string }>,
): { ok: boolean; json: () => Promise<unknown> } {
  return {
    ok: true,
    json: async () => ({
      value: connections.map((c) => ({
        name: c.name,
        properties: {
          privateLinkServiceConnectionState: { status: c.status },
        },
      })),
    }),
  };
}

function mockEmptyPeList(): {
  ok: boolean;
  json: () => Promise<unknown>;
} {
  return {
    ok: true,
    json: async () => ({ value: [] }),
  };
}

describe('lockDownPublicAccess', () => {
  beforeEach(() => {
    rs.useFakeTimers();
    rs.resetAllMocks();
    mockGetToken.mockResolvedValue({ token: 'test-token' });
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  describe('Happy path', () => {
    it('should lock down public access when PE connections are immediately Approved', async () => {
      // PE list for kong: Approved
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      // PE list for frontend: Approved
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // PATCH calls for each app service
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      await lockDownPublicAccess(baseParams);

      // Verify PE list checks
      expect(mockFetch).toHaveBeenCalledWith(
        `${peBaseUrl('my-app-dev-kong')}?api-version=2024-04-01`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        }),
      );

      expect(mockFetch).toHaveBeenCalledWith(
        `${peBaseUrl('my-app-dev-frontend')}?api-version=2024-04-01`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        }),
      );

      // Verify PATCH calls to disable public access
      expect(mockFetch).toHaveBeenCalledWith(
        `${appServiceBaseUrl}/my-app-dev-kong?api-version=2024-04-01`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            properties: { publicNetworkAccess: 'Disabled' },
          }),
        }),
      );

      expect(mockFetch).toHaveBeenCalledWith(
        `${appServiceBaseUrl}/my-app-dev-frontend?api-version=2024-04-01`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            properties: { publicNetworkAccess: 'Disabled' },
          }),
        }),
      );

      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public network access lockdown complete',
      );
    });

    it('should poll until PE connections appear and are Approved', async () => {
      // Poll 1: no PE connections on either app
      mockFetch.mockResolvedValueOnce(mockEmptyPeList());
      mockFetch.mockResolvedValueOnce(mockEmptyPeList());

      // Poll 2: Approved on both
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // PATCH calls
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const promise = lockDownPublicAccess(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('No PE connections yet'),
      );

      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public network access lockdown complete',
      );
    });
  });

  describe('PE approval', () => {
    it('should approve Pending PE connections and lock down', async () => {
      // Poll 1: Pending on both → approve both
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Pending' }]),
      );
      mockFetch.mockResolvedValueOnce({ ok: true }); // PUT approve kong
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Pending' }]),
      );
      mockFetch.mockResolvedValueOnce({ ok: true }); // PUT approve frontend

      // PATCH calls to disable public access
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      await lockDownPublicAccess(baseParams);

      // Verify PE approval PUT calls
      expect(mockFetch).toHaveBeenCalledWith(
        `${peBaseUrl('my-app-dev-kong')}/pe-kong-1?api-version=2024-04-01`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            properties: {
              privateLinkServiceConnectionState: {
                status: 'Approved',
                description: 'Approved by tsdevstack CLI',
              },
            },
          }),
        }),
      );

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Approved PE connection pe-kong-1'),
      );

      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public network access lockdown complete',
      );
    });

    it('should handle full lifecycle: no PE → Pending → approve → lockdown', async () => {
      // Poll 1: no PEs on either
      mockFetch.mockResolvedValueOnce(mockEmptyPeList());
      mockFetch.mockResolvedValueOnce(mockEmptyPeList());

      // Poll 2: Pending on both → approve
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Pending' }]),
      );
      mockFetch.mockResolvedValueOnce({ ok: true }); // PUT approve kong
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Pending' }]),
      );
      mockFetch.mockResolvedValueOnce({ ok: true }); // PUT approve frontend

      // PATCH lockdown
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const promise = lockDownPublicAccess(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  All Private Link connections are operational',
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public network access lockdown complete',
      );
    });

    it('should continue polling when PE approval PUT fails', async () => {
      // Poll 1: Pending on kong → approval fails
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Pending' }]),
      );
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 }); // PUT fails
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // Poll 2: kong now Approved, frontend still Approved
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // PATCH lockdown
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const promise = lockDownPublicAccess(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to approve PE pe-kong-1'),
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public network access lockdown complete',
      );
    });
  });

  describe('Timeout', () => {
    it('should warn and skip lockdown on timeout', async () => {
      // All 40 polls return empty PE list
      for (let i = 0; i < 80; i++) {
        mockFetch.mockResolvedValueOnce(mockEmptyPeList());
      }

      const promise = lockDownPublicAccess(baseParams);

      for (let i = 0; i < 40; i++) {
        await rs.advanceTimersByTimeAsync(15_000);
      }

      await promise;

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('timed out after 10 minutes'),
      );

      // Should NOT have made any PATCH calls
      const patchCalls = mockFetch.mock.calls.filter(
        (call) => (call[1] as { method?: string })?.method === 'PATCH',
      );
      expect(patchCalls).toHaveLength(0);
    });
  });

  describe('Partial approval', () => {
    it('should keep polling when only some App Services have Approved PEs', async () => {
      // Poll 1: kong approved, frontend no PEs yet
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce(mockEmptyPeList());

      // Poll 2: both approved
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // PATCH calls
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const promise = lockDownPublicAccess(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  All Private Link connections are operational',
      );
    });
  });

  describe('Error handling', () => {
    it('should skip lockdown when token acquisition fails', async () => {
      mockGetToken.mockResolvedValueOnce(null);

      await lockDownPublicAccess(baseParams);

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to acquire Azure management token'),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should continue polling when PE list call fails', async () => {
      // Poll 1: both fail
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      // Poll 2: both approved
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // PATCH calls
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const promise = lockDownPublicAccess(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public network access lockdown complete',
      );
    });

    it('should continue polling when fetch throws', async () => {
      // Poll 1: network error
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      // Poll 2: both approved
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // PATCH calls
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const promise = lockDownPublicAccess(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check my-app-dev-kong, retrying...'),
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public network access lockdown complete',
      );
    });

    it('should warn when PATCH to disable public access fails', async () => {
      // Both approved
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // First PATCH fails, second succeeds
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      await lockDownPublicAccess(baseParams);

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to disable public access on my-app-dev-kong',
        ),
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public access disabled on my-app-dev-frontend',
      );
    });
  });

  describe('Single app service', () => {
    it('should work with kong only (no Next.js services)', async () => {
      const params = {
        ...baseParams,
        appServiceNames: ['my-app-dev-kong'],
      };

      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce({ ok: true });

      await lockDownPublicAccess(params);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Public access disabled on my-app-dev-kong',
      );
    });
  });

  describe('Logging', () => {
    it('should log progress on every poll attempt when PE not ready', async () => {
      // Three polls with no PEs
      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce(mockEmptyPeList());
      }

      // Fourth poll: approved
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-kong-1', status: 'Approved' }]),
      );
      mockFetch.mockResolvedValueOnce(
        mockPeListResponse([{ name: 'pe-fe-1', status: 'Approved' }]),
      );

      // PATCH calls
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const promise = lockDownPublicAccess(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await rs.advanceTimersByTimeAsync(15_000);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      // Should have logged status on every poll attempt
      const infoCalls = rs
        .mocked(mocks.logger.info)
        .mock.calls.map((c) => c[0] as string);
      const statusLogs = infoCalls.filter((msg) =>
        msg.includes('No PE connections yet'),
      );
      // 3 failed polls * 2 apps = 6 status logs
      expect(statusLogs.length).toBe(6);
    });
  });
});
