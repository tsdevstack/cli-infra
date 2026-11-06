import { describe, it, expect } from '@rstest/core';
import { buildGcpLogsFilter } from './build-gcp-logs-filter';
import type { LogsQuery } from '../../logs/types';

const QUERY: LogsQuery = {
  sources: [
    { name: 'sync-api-key-usage', type: 'job' },
    { name: 'edge', type: 'edge' },
  ],
  since: new Date('2026-10-30T11:00:00.000Z'),
  until: new Date('2026-10-30T12:00:00.000Z'),
};

const JOB =
  '(resource.type="cloud_scheduler_job" AND resource.labels.job_id="sync-api-key-usage")';
const EDGE =
  '(resource.type="http_load_balancer" AND resource.labels.url_map_name="shop-urlmap")';

describe('buildGcpLogsFilter', () => {
  describe('Standard use cases', () => {
    it('should combine the time window and the sources', () => {
      expect(buildGcpLogsFilter(QUERY, 'shop')).toBe(
        `timestamp>="2026-10-30T11:00:00.000Z" AND timestamp<="2026-10-30T12:00:00.000Z" AND (${JOB} OR ${EDGE})`,
      );
    });

    it('should leave out the time window for a Logs Explorer link', () => {
      expect(buildGcpLogsFilter(QUERY, 'shop', { includeTime: false })).toBe(
        `(${JOB} OR ${EDGE})`,
      );
    });

    it('should add the text search', () => {
      expect(
        buildGcpLogsFilter(
          { ...QUERY, sources: [QUERY.sources[0]], grep: 'req-1' },
          'shop',
          {
            includeTime: false,
          },
        ),
      ).toBe(`${JOB} AND "req-1"`);
    });
  });

  describe('Edge cases', () => {
    it('should escape quotes and backslashes in the text search', () => {
      const filter = buildGcpLogsFilter(
        { ...QUERY, sources: [QUERY.sources[0]], grep: 'say "hi" \\o/' },
        'shop',
        { includeTime: false },
      );
      expect(filter).toBe(`${JOB} AND "say \\"hi\\" \\\\o/"`);
    });

    it('should return nothing when no source has lines of the kind', () => {
      expect(
        buildGcpLogsFilter({ ...QUERY, kind: 'app' }, 'shop'),
      ).toBeUndefined();
    });
  });
});
