import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockSend } = rs.hoisted(() => ({ mockSend: rs.fn() }));

rs.mock('@aws-sdk/client-cloudfront', () => ({
  CloudFrontClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListOriginAccessControlsCommand: rs
    .fn()
    .mockImplementation(function (params) {
      return { _params: params };
    }),
}));

rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: () => ({ region: 'eu-west-1' }),
}));

import { findSpaOriginAccessControl } from './find-spa-origin-access-control';

const options = {
  projectName: 'myapp',
  serviceName: 'admin-ui',
  credentials: {
    region: 'eu-west-1',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret',
    accountId: '123456789012',
  },
};

describe('findSpaOriginAccessControl', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should find the SPA's origin access control by name", async () => {
      mockSend.mockResolvedValueOnce({
        OriginAccessControlList: {
          Items: [
            { Id: 'OAC-OTHER', Name: 'myapp-shop-ui-oac' },
            { Id: 'OAC-ADMIN', Name: 'myapp-admin-ui-oac' },
          ],
          IsTruncated: false,
        },
      });

      expect(await findSpaOriginAccessControl(options)).toEqual({
        success: true,
        id: 'OAC-ADMIN',
      });
    });

    it('should report none when the SPA has none', async () => {
      mockSend.mockResolvedValueOnce({
        OriginAccessControlList: { Items: [], IsTruncated: false },
      });

      expect(await findSpaOriginAccessControl(options)).toEqual({
        success: true,
      });
    });
  });

  describe('Edge cases', () => {
    it('should read the next page', async () => {
      mockSend
        .mockResolvedValueOnce({
          OriginAccessControlList: {
            Items: [],
            IsTruncated: true,
            NextMarker: 'm2',
          },
        })
        .mockResolvedValueOnce({
          OriginAccessControlList: {
            Items: [{ Id: 'OAC-ADMIN', Name: 'myapp-admin-ui-oac' }],
            IsTruncated: false,
          },
        });

      expect((await findSpaOriginAccessControl(options)).id).toBe('OAC-ADMIN');
    });

    it('should report a failed listing', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

      expect(await findSpaOriginAccessControl(options)).toEqual({
        success: false,
        error: 'AccessDenied',
      });
    });
  });
});
