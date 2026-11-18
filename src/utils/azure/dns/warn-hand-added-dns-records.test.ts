import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('./find-hand-added-dns-records', () => ({
  findHandAddedDnsRecords: rs.fn(),
}));

import { warnHandAddedDnsRecords } from './warn-hand-added-dns-records';
import { findHandAddedDnsRecords } from './find-hand-added-dns-records';

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

function printed(): string {
  return [
    ...rs.mocked(mocks.logger.warn).mock.calls,
    ...rs.mocked(mocks.logger.info).mock.calls,
  ]
    .map((call) => String(call[0]))
    .join('\n');
}

describe('warnHandAddedDnsRecords', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should list each hand-added record and how to keep a copy', async () => {
      rs.mocked(findHandAddedDnsRecords).mockResolvedValue([
        {
          zone: 'example.com',
          records: [
            {
              name: 'send',
              type: 'MX',
              values: ['10 feedback-smtp.example.com'],
            },
            { name: 'resend._domainkey', type: 'TXT', values: ['p=MIGf...'] },
          ],
        },
      ]);

      await warnHandAddedDnsRecords(options);

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        "The DNS zone example.com is deleted with the environment, with 2 records the framework didn't make:",
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        '  MX   send               10 feedback-smtp.example.com',
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        '  TXT  resend._domainkey  p=MIGf...',
      );
      expect(printed()).toContain(
        'az network dns zone export --resource-group my-app-dev-rg --name example.com --file-name example.com.txt',
      );
    });
  });

  describe('Edge cases', () => {
    it("should print nothing when every record is the framework's", async () => {
      rs.mocked(findHandAddedDnsRecords).mockResolvedValue([
        { zone: 'example.com', records: [] },
      ]);

      await warnHandAddedDnsRecords(options);

      expect(mocks.logger.warn).not.toHaveBeenCalled();
      expect(mocks.logger.info).not.toHaveBeenCalled();
    });

    it('should warn and go on when the records cannot be listed', async () => {
      rs.mocked(findHandAddedDnsRecords).mockRejectedValue(
        new Error('HTTP 403 from https://management.azure.com/x'),
      );

      await expect(warnHandAddedDnsRecords(options)).resolves.toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Could not list the records of the DNS zone (HTTP 403 from https://management.azure.com/x). The zone is deleted with every record in it.',
      );
    });
  });
});
