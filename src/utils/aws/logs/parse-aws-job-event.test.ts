import { describe, it, expect } from '@rstest/core';
import { parseAwsJobEvent } from './parse-aws-job-event';

const TIME = Date.UTC(2026, 9, 30, 12, 0, 1, 123);

describe('parseAwsJobEvent', () => {
  const source = { name: 'cleanup-tokens', type: 'job' as const };

  it('should read the job function line with its level', () => {
    expect(
      parseAwsJobEvent(
        {
          timestamp: TIME,
          message:
            '2026-10-30T12:00:01.123Z\tabc-123\tINFO\tjob=cleanup-tokens Run finished: 201 in 120ms\n',
        },
        source,
      ),
    ).toMatchObject({
      source: 'cleanup-tokens',
      kind: 'platform',
      level: 'info',
      message: 'Run finished: 201 in 120ms',
    });
  });

  it('should keep the error level of a failed run', () => {
    expect(
      parseAwsJobEvent(
        {
          timestamp: TIME,
          message:
            '2026-10-30T12:00:01.123Z\tabc-123\tERROR\tjob=cleanup-tokens Run failed: fetch failed',
        },
        source,
      )?.level,
    ).toBe('error');
  });

  it("should leave out another job's lines whose name starts the same", () => {
    expect(
      parseAwsJobEvent(
        {
          timestamp: TIME,
          message:
            '2026-10-30T12:00:01.123Z\tabc-123\tINFO\tjob=cleanup-tokens-weekly Run started: POST http://x',
        },
        source,
      ),
    ).toBeUndefined();
  });

  it('should read the lines of a job by its AWS key (service and name)', () => {
    expect(
      parseAwsJobEvent(
        {
          timestamp: TIME,
          message:
            '2026-11-01T13:20:10.300Z\tabc-123\tINFO\tjob=auth-service-sync-api-key-usage Run finished: 201 in 35ms',
        },
        { name: 'sync-api-key-usage', type: 'job', service: 'auth-service' },
      ),
    ).toMatchObject({
      source: 'sync-api-key-usage',
      level: 'info',
      message: 'Run finished: 201 in 35ms',
    });
  });
});
