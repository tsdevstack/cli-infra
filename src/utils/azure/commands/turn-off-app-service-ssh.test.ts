import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { TokenCredential } from '@azure/identity';

const { mockUpdateById, mockClientArgs } = rs.hoisted(() => ({
  mockUpdateById: rs.fn(),
  mockClientArgs: rs.fn(),
}));

rs.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: class {
    resources = { updateById: mockUpdateById };
    constructor(...args: unknown[]) {
      mockClientArgs(...args);
    }
  },
}));

import { turnOffAppServiceSsh } from './turn-off-app-service-ssh';

const credential = {} as TokenCredential;

describe('turnOffAppServiceSsh', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockUpdateById.mockResolvedValue({});
  });

  describe('Standard use cases', () => {
    it("should PATCH only the app's sshEnabled to false", async () => {
      await turnOffAppServiceSsh(
        credential,
        'sub-123',
        'shop-dev-rg',
        'shop-dev-kong',
      );

      expect(mockClientArgs).toHaveBeenCalledWith(credential, 'sub-123');
      expect(mockUpdateById).toHaveBeenCalledWith(
        '/subscriptions/sub-123/resourceGroups/shop-dev-rg/providers/Microsoft.Web/sites/shop-dev-kong',
        '2026-08-01',
        { properties: { sshEnabled: false } },
      );
    });
  });

  describe('Edge cases', () => {
    it('should pass on Azure refusing the update', async () => {
      mockUpdateById.mockRejectedValueOnce(new Error('AuthorizationFailed'));

      await expect(
        turnOffAppServiceSsh(credential, 'sub-123', 'rg', 'app'),
      ).rejects.toThrow('AuthorizationFailed');
    });
  });
});
