/**
 * Tests for approve-private-endpoints
 */

import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockListPrivateEndpointConnectionList = rs.fn();
const mockBeginApproveOrRejectPrivateEndpointConnectionAndWait = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('@azure/identity', () => ({
  ClientSecretCredential: class MockClientSecretCredential {
    constructor() {}
  },
}));

rs.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: class MockWebSiteManagementClient {
    webApps = {
      listPrivateEndpointConnectionList: mockListPrivateEndpointConnectionList,
      beginApproveOrRejectPrivateEndpointConnectionAndWait:
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
    };
    constructor() {}
  },
}));

import { approvePrivateEndpoints } from './approve-private-endpoints';

const baseParams = {
  credentials: {
    subscriptionId: 'sub-123',
    tenantId: 'tenant-456',
    clientId: 'client-789',
    clientSecret: 'secret-abc',
    location: 'eastus',
  },
  resourceGroupName: 'myapp-dev-rg',
  appServiceNames: ['myapp-dev-kong'],
  expectedCount: 1,
};

/**
 * Helper to create an async iterable from an array,
 * mimicking the Azure SDK PagedAsyncIterableIterator.
 */
function toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < items.length) {
            return { value: items[index++], done: false as const };
          }
          return { value: undefined, done: true as const };
        },
      };
    },
  };
}

describe('approvePrivateEndpoints', () => {
  beforeEach(() => {
    rs.useFakeTimers();
    rs.resetAllMocks();
    mockBeginApproveOrRejectPrivateEndpointConnectionAndWait.mockResolvedValue(
      {},
    );
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  describe('Standard use cases', () => {
    it('should approve pending PE connections', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([
          {
            name: 'pe-conn-1',
            privateLinkServiceConnectionState: { status: 'Pending' },
          },
        ]),
      );

      await approvePrivateEndpoints(baseParams);

      expect(
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
      ).toHaveBeenCalledWith('myapp-dev-rg', 'myapp-dev-kong', 'pe-conn-1', {
        privateLinkServiceConnectionState: {
          status: 'Approved',
          description: 'Approved by tsdevstack CLI',
        },
      });
    });

    it('should skip already-approved connections', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([
          {
            name: 'pe-conn-1',
            privateLinkServiceConnectionState: { status: 'Approved' },
          },
        ]),
      );

      const promise = approvePrivateEndpoints(baseParams);
      // Advance through all polling attempts
      for (let i = 0; i < 40; i++) {
        await rs.advanceTimersByTimeAsync(15_000);
      }
      await promise;

      expect(
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
      ).not.toHaveBeenCalled();
    });

    it('should process multiple app services', async () => {
      const params = {
        ...baseParams,
        appServiceNames: ['myapp-dev-kong', 'myapp-dev-frontend'],
        expectedCount: 2,
      };

      mockListPrivateEndpointConnectionList
        .mockReturnValueOnce(
          toAsyncIterable([
            {
              name: 'pe-kong-1',
              privateLinkServiceConnectionState: { status: 'Pending' },
            },
          ]),
        )
        .mockReturnValueOnce(
          toAsyncIterable([
            {
              name: 'pe-frontend-1',
              privateLinkServiceConnectionState: { status: 'Pending' },
            },
          ]),
        );

      await approvePrivateEndpoints(params);

      expect(
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
      ).toHaveBeenCalledTimes(2);
      expect(
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
      ).toHaveBeenCalledWith(
        'myapp-dev-rg',
        'myapp-dev-kong',
        'pe-kong-1',
        expect.objectContaining({
          privateLinkServiceConnectionState: {
            status: 'Approved',
            description: 'Approved by tsdevstack CLI',
          },
        }),
      );
      expect(
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
      ).toHaveBeenCalledWith(
        'myapp-dev-rg',
        'myapp-dev-frontend',
        'pe-frontend-1',
        expect.objectContaining({
          privateLinkServiceConnectionState: {
            status: 'Approved',
            description: 'Approved by tsdevstack CLI',
          },
        }),
      );
    });

    it('should approve multiple pending connections on same app', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([
          {
            name: 'pe-conn-1',
            privateLinkServiceConnectionState: { status: 'Pending' },
          },
          {
            name: 'pe-conn-2',
            privateLinkServiceConnectionState: { status: 'Approved' },
          },
          {
            name: 'pe-conn-3',
            privateLinkServiceConnectionState: { status: 'Pending' },
          },
        ]),
      );

      await approvePrivateEndpoints(baseParams);

      expect(
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
      ).toHaveBeenCalledTimes(2);
    });

    it('should skip connections without a name', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([
          {
            name: undefined,
            privateLinkServiceConnectionState: { status: 'Pending' },
          },
        ]),
      );

      const promise = approvePrivateEndpoints(baseParams);
      for (let i = 0; i < 40; i++) {
        await rs.advanceTimersByTimeAsync(15_000);
      }
      await promise;

      expect(
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
      ).not.toHaveBeenCalled();
    });

    it('should log success count when connections are approved', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([
          {
            name: 'pe-conn-1',
            privateLinkServiceConnectionState: { status: 'Pending' },
          },
        ]),
      );

      await approvePrivateEndpoints(baseParams);

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('1 Private Endpoint connection(s) approved'),
      );
    });
  });

  describe('Polling behavior', () => {
    it('should poll and find connections on second attempt', async () => {
      // First attempt: no connections yet
      // Second attempt: connection appears
      mockListPrivateEndpointConnectionList
        .mockReturnValueOnce(toAsyncIterable([]))
        .mockReturnValueOnce(
          toAsyncIterable([
            {
              name: 'pe-conn-1',
              privateLinkServiceConnectionState: { status: 'Pending' },
            },
          ]),
        );

      const promise = approvePrivateEndpoints(baseParams);
      await rs.advanceTimersByTimeAsync(15_000);
      await promise;

      expect(
        mockBeginApproveOrRejectPrivateEndpointConnectionAndWait,
      ).toHaveBeenCalledTimes(1);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for PE connections'),
      );
    });

    it('should stop polling once expectedCount is reached', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([
          {
            name: 'pe-conn-1',
            privateLinkServiceConnectionState: { status: 'Pending' },
          },
        ]),
      );

      await approvePrivateEndpoints(baseParams);

      // Should have listed only once (first attempt succeeded)
      expect(mockListPrivateEndpointConnectionList).toHaveBeenCalledTimes(1);
    });

    it('should warn on timeout with zero approvals', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([]),
      );

      const promise = approvePrivateEndpoints(baseParams);
      // Advance through all 40 polling intervals
      for (let i = 0; i < 40; i++) {
        await rs.advanceTimersByTimeAsync(15_000);
      }
      await promise;

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'No pending Private Endpoint connections found after polling',
        ),
      );
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('re-run infra:deploy'),
      );
    });

    it('should warn on partial approval', async () => {
      const params = {
        ...baseParams,
        appServiceNames: ['myapp-dev-kong', 'myapp-dev-frontend'],
        expectedCount: 2,
      };

      // Kong gets a pending connection on first call, frontend never does
      let kongFirstCall = true;
      mockListPrivateEndpointConnectionList.mockImplementation(
        (_rg: string, appName: string) => {
          if (appName === 'myapp-dev-kong' && kongFirstCall) {
            kongFirstCall = false;
            return toAsyncIterable([
              {
                name: 'pe-kong-1',
                privateLinkServiceConnectionState: { status: 'Pending' },
              },
            ]);
          }
          return toAsyncIterable([]);
        },
      );

      const promise = approvePrivateEndpoints(params);
      // After first attempt, kong is approved (1/2) but need to keep polling
      for (let i = 0; i < 40; i++) {
        await rs.advanceTimersByTimeAsync(15_000);
      }
      await promise;

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('1/2 PE connections approved'),
      );
    });

    it('should not throw on timeout (deploy should continue)', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([]),
      );

      const promise = approvePrivateEndpoints(baseParams);
      for (let i = 0; i < 40; i++) {
        await rs.advanceTimersByTimeAsync(15_000);
      }

      // Should resolve, not reject
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when listing PE connections fails', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        // Simulate an async iterable that throws on iteration
        {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw new Error('Permission denied');
              },
            };
          },
        },
      );

      await expect(approvePrivateEndpoints(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw CliError when approval call fails', async () => {
      mockListPrivateEndpointConnectionList.mockReturnValue(
        toAsyncIterable([
          {
            name: 'pe-conn-1',
            privateLinkServiceConnectionState: { status: 'Pending' },
          },
        ]),
      );
      mockBeginApproveOrRejectPrivateEndpointConnectionAndWait.mockRejectedValue(
        new Error('Forbidden'),
      );

      await expect(approvePrivateEndpoints(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });
  });
});
