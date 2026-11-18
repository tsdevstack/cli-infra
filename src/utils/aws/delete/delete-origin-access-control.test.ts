import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockSend } = rs.hoisted(() => ({ mockSend: rs.fn() }));

rs.mock('@aws-sdk/client-cloudfront', () => {
  const command = (type: string) =>
    rs.fn().mockImplementation(function (params) {
      return { _type: type, _params: params };
    });
  return {
    CloudFrontClient: rs.fn().mockImplementation(function () {
      return { send: mockSend };
    }),
    GetOriginAccessControlCommand: command('get'),
    DeleteOriginAccessControlCommand: command('delete'),
  };
});

rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: () => ({ region: 'eu-west-1' }),
}));

import { deleteOriginAccessControl } from './delete-origin-access-control';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
  accountId: '123456789012',
};

describe('deleteOriginAccessControl', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should delete it with its current ETag', async () => {
      mockSend
        .mockResolvedValueOnce({ ETag: 'E-OAC' })
        .mockResolvedValueOnce({});

      const result = await deleteOriginAccessControl({
        originAccessControlId: 'OAC123',
        credentials,
      });

      expect(result).toEqual({ success: true, deleted: true });
      expect(mockSend.mock.calls[1][0]).toEqual({
        _type: 'delete',
        _params: { Id: 'OAC123', IfMatch: 'E-OAC' },
      });
    });
  });

  describe('Edge cases', () => {
    it('should count one that is already gone as deleted', async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error('missing'), {
          name: 'NoSuchOriginAccessControl',
        }),
      );

      expect(
        await deleteOriginAccessControl({
          originAccessControlId: 'OAC123',
          credentials,
        }),
      ).toEqual({ success: true, deleted: false });
    });

    it('should report one a distribution still uses', async () => {
      mockSend.mockResolvedValueOnce({ ETag: 'E-OAC' }).mockRejectedValueOnce(
        Object.assign(new Error('in use'), {
          name: 'OriginAccessControlInUse',
        }),
      );

      expect(
        await deleteOriginAccessControl({
          originAccessControlId: 'OAC123',
          credentials,
        }),
      ).toEqual({ success: false, deleted: false, error: 'in use' });
    });
  });
});
