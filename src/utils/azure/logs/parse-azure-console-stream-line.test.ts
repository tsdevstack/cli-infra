import { describe, it, expect } from '@rstest/core';
import { parseAzureConsoleStreamLine } from './parse-azure-console-stream-line';
import type { LogSource } from '../../logs/types';

const SOURCE: LogSource = { name: 'auth-service', type: 'service' };
const NOW = new Date('2026-11-10T12:30:00.000Z');

describe('parseAzureConsoleStreamLine', () => {
  describe('Standard use cases', () => {
    it('should read our pino line out of the stream line', () => {
      const line = JSON.stringify({
        TimeStamp: '2026-11-10T12:00:01.123456',
        Log: JSON.stringify({
          level: 'error',
          msg: 'Payment failed',
          correlationId: 'c1',
        }),
      });

      expect(parseAzureConsoleStreamLine(line, SOURCE, NOW)).toMatchObject({
        time: '2026-11-10T12:00:01.123Z',
        source: 'auth-service',
        kind: 'app',
        level: 'error',
        message: 'Payment failed',
        fields: { correlationId: 'c1' },
      });
    });

    it("should drop the container runtime's line flag", () => {
      const line = JSON.stringify({
        TimeStamp: '2026-11-10T12:00:01',
        Log: 'F {"level":"info","msg":"Ready"}',
      });

      expect(parseAzureConsoleStreamLine(line, SOURCE, NOW)).toMatchObject({
        level: 'info',
        message: 'Ready',
      });
    });

    it('should keep plain text without a level', () => {
      const entry = parseAzureConsoleStreamLine(
        JSON.stringify({ TimeStamp: '2026-11-10T12:00:01', Log: 'Listening' }),
        SOURCE,
        NOW,
      );

      expect(entry).toMatchObject({ kind: 'app', message: 'Listening' });
      expect(entry?.level).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it("should skip the stream's own connection notes", () => {
      for (const Log of [
        "Connecting to the container 'auth-service'...",
        "Successfully Connected to container: 'auth-service' [Revision: 'r1', Replica: 'x']",
      ]) {
        expect(
          parseAzureConsoleStreamLine(
            JSON.stringify({ TimeStamp: '2026-11-10T12:00:01', Log }),
            SOURCE,
            NOW,
          ),
        ).toBeUndefined();
      }
    });

    it('should take a line that is not JSON as its text, timed now', () => {
      expect(
        parseAzureConsoleStreamLine('plain output', SOURCE, NOW),
      ).toMatchObject({ time: NOW.toISOString(), message: 'plain output' });
    });

    it('should skip empty lines', () => {
      expect(
        parseAzureConsoleStreamLine(
          JSON.stringify({ TimeStamp: '2026-11-10T12:00:01', Log: '  ' }),
          SOURCE,
          NOW,
        ),
      ).toBeUndefined();
    });
  });
});
