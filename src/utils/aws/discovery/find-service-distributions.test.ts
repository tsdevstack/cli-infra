import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockSend } = rs.hoisted(() => ({ mockSend: rs.fn() }));

rs.mock('@aws-sdk/client-cloudfront', () => ({
  CloudFrontClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListDistributionsCommand: rs.fn().mockImplementation(function (params) {
    return { _params: params };
  }),
}));

rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: () => ({ region: 'eu-west-1' }),
}));

import { findServiceDistributions } from './find-service-distributions';

const options = {
  projectName: 'myapp',
  targetEnv: 'dev',
  serviceName: 'admin-ui',
  credentials: {
    region: 'eu-west-1',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret',
    accountId: '123456789012',
  },
};

function page(
  items: object[],
  nextMarker?: string,
): { DistributionList: object } {
  return {
    DistributionList: {
      Items: items,
      IsTruncated: nextMarker !== undefined,
      NextMarker: nextMarker,
    },
  };
}

describe('findServiceDistributions', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should find an SPA's distribution by its bucket origin", async () => {
      mockSend.mockResolvedValueOnce(
        page([
          {
            Id: 'E2SPA',
            Origins: {
              Items: [
                {
                  DomainName:
                    'myapp-admin-ui-spa-123456789012.s3.eu-west-1.amazonaws.com',
                },
              ],
            },
          },
        ]),
      );

      const result = await findServiceDistributions(options);

      expect(result).toEqual({
        success: true,
        distributions: [{ id: 'E2SPA', kind: 'spa' }],
      });
    });

    it("should find a Next.js app's distribution by its comment", async () => {
      mockSend.mockResolvedValueOnce(
        page([
          {
            Id: 'E2NEXT',
            Comment: 'myapp-dev-admin-ui-cdn',
            Origins: { Items: [{ DomainName: 'alb.example.com' }] },
          },
        ]),
      );

      const result = await findServiceDistributions(options);

      expect(result.distributions).toEqual([{ id: 'E2NEXT', kind: 'nextjs' }]);
    });

    it('should leave the shared API distribution and other services alone', async () => {
      mockSend.mockResolvedValueOnce(
        page([
          {
            Id: 'E2API',
            Comment: 'myapp-dev-api',
            Origins: { Items: [{ DomainName: 'alb.example.com' }] },
          },
          {
            Id: 'E2OTHER',
            Origins: {
              Items: [
                {
                  DomainName:
                    'myapp-shop-ui-spa-123456789012.s3.eu-west-1.amazonaws.com',
                },
              ],
            },
          },
        ]),
      );

      expect((await findServiceDistributions(options)).distributions).toEqual(
        [],
      );
    });
  });

  describe('Edge cases', () => {
    it('should read every page', async () => {
      mockSend
        .mockResolvedValueOnce(page([], 'next-page'))
        .mockResolvedValueOnce(
          page([{ Id: 'E2NEXT', Comment: 'myapp-dev-admin-ui-cdn' }]),
        );

      const result = await findServiceDistributions(options);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[1][0]).toEqual({
        _params: { Marker: 'next-page' },
      });
      expect(result.distributions).toEqual([{ id: 'E2NEXT', kind: 'nextjs' }]);
    });

    it('should report a failed listing', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

      expect(await findServiceDistributions(options)).toEqual({
        success: false,
        distributions: [],
        error: 'AccessDenied',
      });
    });
  });
});
