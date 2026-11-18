import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockSend, mockWait } = rs.hoisted(() => ({
  mockSend: rs.fn(),
  mockWait: rs.fn(),
}));

rs.mock('@aws-sdk/client-cloudfront', () => {
  const command = (type: string) =>
    rs.fn().mockImplementation(function (params) {
      return { _type: type, _params: params };
    });
  return {
    CloudFrontClient: rs.fn().mockImplementation(function () {
      return { send: mockSend };
    }),
    GetDistributionConfigCommand: command('get-config'),
    UpdateDistributionCommand: command('update'),
    GetDistributionCommand: command('get'),
    DeleteDistributionCommand: command('delete'),
    waitUntilDistributionDeployed: mockWait,
  };
});

rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: () => ({ region: 'eu-west-1' }),
}));

import { deleteCloudFrontDistribution } from './delete-cloudfront-distribution';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
  accountId: '123456789012',
};

function sentTypes(): string[] {
  return mockSend.mock.calls.map(
    (call) => (call[0] as { _type: string })._type,
  );
}

describe('deleteCloudFrontDistribution', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockWait.mockResolvedValue({ state: 'SUCCESS' });
  });

  describe('Standard use cases', () => {
    it('should disable, wait for the deploy, then delete', async () => {
      mockSend.mockImplementation(async (command: { _type: string }) => {
        if (command._type === 'get-config') {
          return {
            ETag: 'E-ENABLED',
            DistributionConfig: { Enabled: true, Comment: 'x' },
          };
        }
        if (command._type === 'get') return { ETag: 'E-DISABLED' };
        return {};
      });

      const result = await deleteCloudFrontDistribution({
        distributionId: 'E2SPA',
        credentials,
      });

      expect(result).toEqual({ success: true, deleted: true });
      expect(sentTypes()).toEqual(['get-config', 'update', 'get', 'delete']);
      expect(mockSend.mock.calls[1][0]).toEqual({
        _type: 'update',
        _params: {
          Id: 'E2SPA',
          IfMatch: 'E-ENABLED',
          DistributionConfig: { Enabled: false, Comment: 'x' },
        },
      });
      expect(mockWait).toHaveBeenCalledWith(
        expect.objectContaining({ maxWaitTime: 1800 }),
        { Id: 'E2SPA' },
      );
      expect(mockSend.mock.calls[3][0]).toEqual({
        _type: 'delete',
        _params: { Id: 'E2SPA', IfMatch: 'E-DISABLED' },
      });
    });
  });

  describe('Edge cases', () => {
    it('should not disable again a distribution a stopped run already disabled', async () => {
      mockSend.mockImplementation(async (command: { _type: string }) => {
        if (command._type === 'get-config') {
          return { ETag: 'E1', DistributionConfig: { Enabled: false } };
        }
        if (command._type === 'get') return { ETag: 'E1' };
        return {};
      });

      await deleteCloudFrontDistribution({
        distributionId: 'E2SPA',
        credentials,
      });

      expect(sentTypes()).toEqual(['get-config', 'get', 'delete']);
    });

    it('should count a distribution that is already gone as deleted', async () => {
      const gone = Object.assign(new Error('missing'), {
        name: 'NoSuchDistribution',
      });
      mockSend.mockRejectedValueOnce(gone);

      expect(
        await deleteCloudFrontDistribution({
          distributionId: 'E2SPA',
          credentials,
        }),
      ).toEqual({ success: true, deleted: false });
    });

    it('should report a wait that runs out', async () => {
      mockSend.mockResolvedValueOnce({
        ETag: 'E1',
        DistributionConfig: { Enabled: false },
      });
      mockWait.mockRejectedValueOnce(new Error('Waiter timed out'));

      expect(
        await deleteCloudFrontDistribution({
          distributionId: 'E2SPA',
          credentials,
        }),
      ).toEqual({ success: false, deleted: false, error: 'Waiter timed out' });
    });
  });
});
