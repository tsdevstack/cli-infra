import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { resolveAzureNaming } from './resolve-azure-naming';

describe('resolveAzureNaming', () => {
  describe('Standard use cases', () => {
    it("should pair the environment's scheme with its subscription", async () => {
      const mocks = (globalThis as unknown as { contextMocks: MockContext })
        .contextMocks;
      rs.mocked(mocks.resolveAzureNamingScheme).mockResolvedValueOnce('unique');

      await expect(
        resolveAzureNaming(
          {
            clientId: 'c',
            tenantId: 't',
            subscriptionId: 'sub-1',
            location: 'eastus',
          },
          'shop',
          'dev',
        ),
      ).resolves.toEqual({ scheme: 'unique', subscriptionId: 'sub-1' });
    });
  });
});
