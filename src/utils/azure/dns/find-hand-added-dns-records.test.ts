import { describe, it, expect, rs, beforeEach } from '@rstest/core';

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: () => ({
    getToken: async () => ({ token: 'token' }),
  }),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../fetch-arm-list', () => ({ fetchArmList: rs.fn() }));

import { findHandAddedDnsRecords } from './find-hand-added-dns-records';
import { fetchArmList } from '../fetch-arm-list';

const options = {
  credentials: {
    subscriptionId: 'sub-123',
    tenantId: 't',
    clientId: 'c',
    clientSecret: 's',
    location: 'eastus',
  },
  resourceGroupName: 'my-app-dev-rg',
  projectName: 'my-app',
  environment: 'dev',
};

const OUR_TAGS = {
  ManagedBy: 'tsdevstack',
  Project: 'my-app',
  Environment: 'dev',
};

describe('findHandAddedDnsRecords', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('Standard use cases', () => {
    it("should list only the records the framework didn't make, in the framework's zone", async () => {
      rs.mocked(fetchArmList)
        .mockResolvedValueOnce([
          { name: 'example.com', tags: OUR_TAGS },
          { name: 'other.com', tags: { Team: 'x' } },
        ])
        .mockResolvedValueOnce([
          { name: '@', type: 'Microsoft.Network/dnszones/NS' },
          { name: '_dnsauth.api', type: 'Microsoft.Network/dnszones/TXT' },
          {
            name: 'api',
            type: 'Microsoft.Network/dnszones/CNAME',
            properties: { CNAMERecord: { cname: 'x.z01.azurefd.net' } },
          },
          {
            name: 'send',
            type: 'Microsoft.Network/dnszones/MX',
            properties: {
              MXRecords: [
                { preference: 10, exchange: 'feedback-smtp.example.com' },
              ],
            },
          },
        ]);

      expect(await findHandAddedDnsRecords(options)).toEqual([
        {
          zone: 'example.com',
          records: [
            {
              name: 'send',
              type: 'MX',
              values: ['10 feedback-smtp.example.com'],
            },
          ],
        },
      ]);
      expect(rs.mocked(fetchArmList).mock.calls[0][0]).toBe(
        'https://management.azure.com/subscriptions/sub-123/resourceGroups/my-app-dev-rg/providers/Microsoft.Network/dnsZones?api-version=2018-05-01',
      );
      expect(rs.mocked(fetchArmList).mock.calls[1][0]).toBe(
        'https://management.azure.com/subscriptions/sub-123/resourceGroups/my-app-dev-rg/providers/Microsoft.Network/dnsZones/example.com/recordsets?api-version=2018-05-01',
      );
      expect(fetchArmList).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge cases', () => {
    it('should give nothing when the resource group has no framework zone', async () => {
      rs.mocked(fetchArmList).mockResolvedValueOnce([
        { name: 'example.com', tags: { ...OUR_TAGS, Environment: 'prod' } },
      ]);

      expect(await findHandAddedDnsRecords(options)).toEqual([]);
      expect(fetchArmList).toHaveBeenCalledTimes(1);
    });
  });
});
