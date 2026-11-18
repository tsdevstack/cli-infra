import { describe, it, expect } from '@rstest/core';
import { getDnsRecordType } from './get-dns-record-type';

describe('getDnsRecordType', () => {
  describe('Standard use cases', () => {
    it('should take the type from the resource type', () => {
      expect(
        getDnsRecordType({
          name: 'send',
          type: 'Microsoft.Network/dnszones/MX',
        }),
      ).toBe('MX');
    });
  });

  describe('Edge cases', () => {
    it('should upper-case a type written in lower case', () => {
      expect(
        getDnsRecordType({ name: 'x', type: 'Microsoft.Network/dnsZones/txt' }),
      ).toBe('TXT');
    });
  });
});
