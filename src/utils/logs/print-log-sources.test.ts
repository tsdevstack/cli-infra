import { describe, it, expect, rs } from '@rstest/core';
import { printLogSources } from './print-log-sources';
import type { LogSourceLastLogged } from './types';

const RESULTS: LogSourceLastLogged[] = [
  {
    source: { name: 'auth-service', type: 'service' },
    lastLogged: '2026-10-30T11:58:02.123Z',
  },
  { source: { name: 'kong', type: 'kong' } },
];

describe('printLogSources', () => {
  describe('Standard use cases', () => {
    it('should list each source with its last line and how to read them', () => {
      const write = rs.fn();
      printLogSources(RESULTS, 'dev', false, write);

      expect((write.mock.calls[0][0] as string).split('\n')).toEqual([
        "Log sources in dev, with each one's last line (UTC):",
        '',
        '  auth-service  service  2026-10-30 11:58:02',
        '  kong          kong     nothing in the past 30 days',
        '',
        'Read one source:   npx tsdevstack infra:logs <source> --env dev',
        'Read all sources:  npx tsdevstack infra:logs --all --env dev',
        '',
      ]);
    });

    it('should write one JSON object per source', () => {
      const write = rs.fn();
      printLogSources(RESULTS, 'dev', true, write);

      const lines = (write.mock.calls[0][0] as string).trim().split('\n');
      expect(lines.map((line) => JSON.parse(line))).toEqual([
        {
          source: 'auth-service',
          type: 'service',
          lastLogged: '2026-10-30T11:58:02.123Z',
        },
        { source: 'kong', type: 'kong', lastLogged: null },
      ]);
    });
  });
});
