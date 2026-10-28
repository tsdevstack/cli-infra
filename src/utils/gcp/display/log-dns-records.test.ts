import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { logDnsRecords } from './log-dns-records';

describe('logDnsRecords', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  const lines = (): string[] =>
    mocks.logger.info.mock.calls.map((call: unknown[]) => String(call[0]));

  describe('Standard use cases', () => {
    it('should print one table per record type present', () => {
      logDnsRecords([
        { type: 'A', host: 'api.example.com', value: '34.0.0.1' },
        {
          type: 'CNAME',
          host: '_acme-challenge.example.com.',
          value: 'abc.authorize.goog.',
        },
      ]);

      expect(lines()).toContain('  A Records (point to load balancer IP):');
      expect(lines()).toContain('    api.example.com  34.0.0.1');
      expect(lines().some((line) => line.includes('CNAME records'))).toBe(true);
      expect(lines().some((line) => line.includes('AAAA Records'))).toBe(false);
    });

    it('should say where to add them and what each kind does', () => {
      logDnsRecords([
        { type: 'A', host: 'api.example.com', value: '34.0.0.1' },
        {
          type: 'CNAME',
          host: '_acme-challenge.example.com.',
          value: 'abc.authorize.goog.',
        },
      ]);

      expect(lines()[0]).toBe(
        'DNS records to add at your registrar (missing or pointing elsewhere):',
      );
      expect(lines().some((line) => line.includes('send each domain'))).toBe(
        true,
      );
      expect(lines().some((line) => line.includes('renewals use them'))).toBe(
        true,
      );
      expect(lines().some((line) => line.includes('A new app or domain'))).toBe(
        true,
      );
    });

    it('should explain only the record types in the list', () => {
      logDnsRecords([
        { type: 'A', host: 'api.example.com', value: '34.0.0.1' },
      ]);

      expect(lines().some((line) => line.includes('send each domain'))).toBe(
        true,
      );
      expect(lines().some((line) => line.includes('_acme-challenge'))).toBe(
        false,
      );
    });
  });

  describe('Edge cases', () => {
    it('should print nothing for no records', () => {
      logDnsRecords([]);

      expect(mocks.logger.info).not.toHaveBeenCalled();
    });
  });
});
