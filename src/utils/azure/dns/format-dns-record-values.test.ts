import { describe, it, expect } from '@rstest/core';
import { formatDnsRecordValues } from './format-dns-record-values';

describe('formatDnsRecordValues', () => {
  describe('Standard use cases', () => {
    it('should write each record type as people write it', () => {
      expect(
        formatDnsRecordValues({
          name: 'send',
          type: 'Microsoft.Network/dnszones/MX',
          properties: {
            MXRecords: [
              { preference: 10, exchange: 'feedback-smtp.example.com' },
            ],
          },
        }),
      ).toEqual(['10 feedback-smtp.example.com']);
      expect(
        formatDnsRecordValues({
          name: '_dmarc',
          type: 'Microsoft.Network/dnszones/TXT',
          properties: { TXTRecords: [{ value: ['v=DMARC1; ', 'p=none;'] }] },
        }),
      ).toEqual(['v=DMARC1; p=none;']);
      expect(
        formatDnsRecordValues({
          name: '@',
          type: 'Microsoft.Network/dnszones/CAA',
          properties: {
            CAARecords: [{ flags: 0, tag: 'issue', value: 'letsencrypt.org' }],
          },
        }),
      ).toEqual(['0 issue "letsencrypt.org"']);
    });
  });

  describe('Edge cases', () => {
    it('should shorten a long value such as a DKIM key', () => {
      const [value] = formatDnsRecordValues({
        name: 'resend._domainkey',
        type: 'Microsoft.Network/dnszones/TXT',
        properties: { TXTRecords: [{ value: [`p=${'A'.repeat(200)}`] }] },
      });

      expect(value).toHaveLength(63);
      expect(value.endsWith('...')).toBe(true);
    });

    it('should give nothing for a record set without values', () => {
      expect(
        formatDnsRecordValues({
          name: 'x',
          type: 'Microsoft.Network/dnszones/A',
        }),
      ).toEqual([]);
    });
  });
});
