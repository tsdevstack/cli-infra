import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { logAaaaRecords } from './log-aaaa-records';

const loggedLines = (): string[] =>
  mocks.logger.info.mock.calls.map((call) => String(call[0]));

describe('logAaaaRecords', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should log one AAAA record per host with the IPv6 address', () => {
      logAaaaRecords(['api.example.com', 'example.com'], '2600:1901:0:1::');

      const lines = loggedLines();
      expect(lines).toContain(
        '  AAAA Records (point to load balancer IPv6 address):',
      );
      expect(lines).toContain('    api.example.com  2600:1901:0:1::');
      expect(lines).toContain('    example.com      2600:1901:0:1::');
    });
  });

  describe('Edge cases', () => {
    it('should log nothing without an IPv6 address', () => {
      logAaaaRecords(['api.example.com'], '');

      expect(mocks.logger.info).not.toHaveBeenCalled();
    });

    it('should log nothing without hosts', () => {
      logAaaaRecords([], '2600:1901:0:1::');

      expect(mocks.logger.info).not.toHaveBeenCalled();
    });
  });
});
