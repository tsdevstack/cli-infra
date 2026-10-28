import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { resolve4, resolve6, resolveCname } = rs.hoisted(() => ({
  resolve4: rs.fn(),
  resolve6: rs.fn(),
  resolveCname: rs.fn(),
}));

rs.mock('node:dns/promises', () => ({
  Resolver: class {
    resolve4 = resolve4;
    resolve6 = resolve6;
    resolveCname = resolveCname;
  },
}));

import { findMissingDnsRecords } from './find-missing-dns-records';
import type { DnsRecord } from './types';

describe('findMissingDnsRecords', () => {
  const a: DnsRecord = { type: 'A', host: 'example.com', value: '34.0.0.1' };
  const aaaa: DnsRecord = {
    type: 'AAAA',
    host: 'example.com',
    value: '2600:1901:0:350d::',
  };
  const cname: DnsRecord = {
    type: 'CNAME',
    host: '_acme-challenge.example.com.',
    value: 'abc.17.authorize.certificatemanager.goog.',
  };

  beforeEach(() => {
    rs.resetAllMocks();
    resolve4.mockResolvedValue(['34.0.0.1']);
    resolve6.mockResolvedValue(['2600:1901:0:350d::']);
    resolveCname.mockResolvedValue([
      'abc.17.authorize.certificatemanager.goog',
    ]);
  });

  describe('Standard use cases', () => {
    it('should report nothing when every record resolves as expected', async () => {
      await expect(findMissingDnsRecords([a, aaaa, cname])).resolves.toEqual(
        [],
      );
      expect(resolveCname).toHaveBeenCalledWith('_acme-challenge.example.com');
    });

    it('should report a record that points elsewhere', async () => {
      resolve4.mockResolvedValue(['10.0.0.9']);

      await expect(findMissingDnsRecords([a, cname])).resolves.toEqual([a]);
    });
  });

  describe('Edge cases', () => {
    it('should match an IPv6 address written out in full', async () => {
      resolve6.mockResolvedValue(['2600:1901:0:350d:0:0:0:0']);

      await expect(findMissingDnsRecords([aaaa])).resolves.toEqual([]);
    });

    it('should match a CNAME regardless of case and trailing dot', async () => {
      resolveCname.mockResolvedValue([
        'ABC.17.authorize.certificatemanager.goog.',
      ]);

      await expect(findMissingDnsRecords([cname])).resolves.toEqual([]);
    });

    it('should count a failed lookup as missing', async () => {
      resolve4.mockRejectedValue(
        Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' }),
      );

      await expect(findMissingDnsRecords([a])).resolves.toEqual([a]);
    });
  });
});
