import { describe, it, expect } from '@rstest/core';
import { buildAzureLogsQuery } from './build-azure-logs-query';
import type { LogsQuery } from '../../logs/types';

const NAMES = { projectName: 'shop', targetEnv: 'az4' };
const QUERY: LogsQuery = {
  sources: [{ name: 'edge', type: 'edge' }],
  since: new Date('2026-10-30T11:00:00.000Z'),
  until: new Date('2026-10-30T12:00:00.000Z'),
};
const WINDOW = {
  from: new Date('2026-10-30T11:00:00.000Z'),
  to: new Date('2026-10-30T11:15:00.000Z'),
  includeEnd: false,
};

describe('buildAzureLogsQuery', () => {
  describe('Standard use cases', () => {
    it('should union the legs, limit the window and add the tail', () => {
      const kql = buildAzureLogsQuery(
        QUERY,
        NAMES,
        WINDOW,
        '| order by TimeGenerated asc',
      );
      const lines = kql?.split('\n') ?? [];
      expect(lines[0]).toMatch(/^union isfuzzy=true \(AzureDiagnostics/);
      expect(lines[1]).toBe(
        '| where TimeGenerated >= datetime(2026-10-30T11:00:00.000Z) and TimeGenerated < datetime(2026-10-30T11:15:00.000Z)',
      );
      expect(lines[2]).toBe('| order by TimeGenerated asc');
    });

    it('should include the end of the last slice and search the text', () => {
      const kql = buildAzureLogsQuery(
        { ...QUERY, grep: 'say "hi"' },
        NAMES,
        { ...WINDOW, includeEnd: true },
        '| count',
      );
      expect(kql).toContain(
        'and TimeGenerated <= datetime(2026-10-30T11:15:00.000Z)',
      );
      expect(kql).toContain('| where tostring(Raw) contains "say \\"hi\\""');
    });
  });

  describe('Edge cases', () => {
    it('should return nothing when no source has lines of the kind', () => {
      expect(
        buildAzureLogsQuery(
          { ...QUERY, kind: 'app' },
          NAMES,
          WINDOW,
          '| count',
        ),
      ).toBeUndefined();
    });
  });
});
