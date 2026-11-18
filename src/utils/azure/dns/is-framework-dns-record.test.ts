import { describe, it, expect } from '@rstest/core';
import { isFrameworkDnsRecord } from './is-framework-dns-record';
import type { AzureDnsRecordSet } from './types';

function record(
  name: string,
  type: string,
  properties: AzureDnsRecordSet['properties'] = {},
): AzureDnsRecordSet {
  return { name, type: `Microsoft.Network/dnszones/${type}`, properties };
}

describe('isFrameworkDnsRecord', () => {
  describe('Standard use cases', () => {
    it("should count Azure's NS and SOA at the apex as not hand-added", () => {
      expect(isFrameworkDnsRecord(record('@', 'NS'))).toBe(true);
      expect(isFrameworkDnsRecord(record('@', 'SOA'))).toBe(true);
    });

    it("should recognize Front Door's validation, CNAME and apex alias records", () => {
      expect(isFrameworkDnsRecord(record('_dnsauth', 'TXT'))).toBe(true);
      expect(isFrameworkDnsRecord(record('_dnsauth.api', 'TXT'))).toBe(true);
      expect(
        isFrameworkDnsRecord(
          record('api', 'CNAME', {
            CNAMERecord: { cname: 'myapp-dev-api-abc123.z01.azurefd.net' },
          }),
        ),
      ).toBe(true);
      expect(
        isFrameworkDnsRecord(
          record('@', 'A', {
            targetResource: {
              id: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Cdn/profiles/p/afdEndpoints/e',
            },
          }),
        ),
      ).toBe(true);
    });

    it("should count Resend's email records as hand-added", () => {
      expect(
        isFrameworkDnsRecord(
          record('send', 'MX', {
            MXRecords: [
              { preference: 10, exchange: 'feedback-smtp.example.com' },
            ],
          }),
        ),
      ).toBe(false);
      expect(isFrameworkDnsRecord(record('resend._domainkey', 'TXT'))).toBe(
        false,
      );
      expect(isFrameworkDnsRecord(record('_dmarc', 'TXT'))).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should count a delegation NS below the apex as hand-added', () => {
      expect(isFrameworkDnsRecord(record('staging', 'NS'))).toBe(false);
    });

    it('should count a CNAME or A record elsewhere as hand-added', () => {
      expect(
        isFrameworkDnsRecord(
          record('www', 'CNAME', {
            CNAMERecord: { cname: 'example.netlify.app' },
          }),
        ),
      ).toBe(false);
      expect(
        isFrameworkDnsRecord(
          record('@', 'A', { ARecords: [{ ipv4Address: '192.0.2.1' }] }),
        ),
      ).toBe(false);
    });

    it('should accept a CNAME target with a trailing dot', () => {
      expect(
        isFrameworkDnsRecord(
          record('app', 'CNAME', {
            CNAMERecord: { cname: 'myapp-dev-app.z01.azurefd.net.' },
          }),
        ),
      ).toBe(true);
    });
  });
});
