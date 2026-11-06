import { describe, it, expect } from '@rstest/core';
import { buildGcpLogsExplorerUrl } from './build-gcp-logs-explorer-url';

describe('buildGcpLogsExplorerUrl', () => {
  describe('Standard use cases', () => {
    it('should link to the query and the time window', () => {
      expect(
        buildGcpLogsExplorerUrl(
          'shop-dev-123',
          '(resource.type="cloud_run_revision")',
          new Date('2026-10-30T11:00:00.000Z'),
          new Date('2026-10-30T12:00:00.000Z'),
        ),
      ).toBe(
        'https://console.cloud.google.com/logs/query' +
          ';query=%28resource.type%3D%22cloud_run_revision%22%29' +
          ';timeRange=2026-10-30T11:00:00Z%2F2026-10-30T12:00:00Z' +
          '?project=shop-dev-123',
      );
    });
  });

  describe('Edge cases', () => {
    it('should drop milliseconds and round the end up', () => {
      const url = buildGcpLogsExplorerUrl(
        'p',
        'x',
        new Date('2026-10-30T11:00:00.700Z'),
        new Date('2026-10-30T12:00:00.200Z'),
      );
      expect(url).toContain(
        ';timeRange=2026-10-30T11:00:00Z%2F2026-10-30T12:00:01Z?',
      );
    });

    it('should encode semicolons so they cannot end the query parameter', () => {
      const url = buildGcpLogsExplorerUrl(
        'p',
        '"a;b"',
        new Date(0),
        new Date(1000),
      );
      expect(url).toContain(';query=%22a%3Bb%22;timeRange=');
    });

    it('should encode the characters the console escapes', () => {
      const url = buildGcpLogsExplorerUrl(
        'p',
        "NOT (a!='b*') AND c:d",
        new Date(0),
        new Date(1000),
      );
      expect(url).toContain(
        ';query=NOT%20%28a%21%3D%27b%2A%27%29%20AND%20c:d;',
      );
    });
  });
});
