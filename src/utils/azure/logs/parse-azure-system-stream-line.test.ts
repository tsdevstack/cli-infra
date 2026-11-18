import { describe, it, expect } from '@rstest/core';
import { parseAzureSystemStreamLine } from './parse-azure-system-stream-line';
import type { LogSource } from '../../logs/types';

const SOURCE: LogSource = { name: 'auth-service', type: 'service' };
const NOW = new Date('2026-11-10T12:30:00.000Z');

describe('parseAzureSystemStreamLine', () => {
  describe('Standard use cases', () => {
    it('should write an event as "Reason: message" with its level', () => {
      const line = JSON.stringify({
        TimeStamp: '2026-11-10 12:00:01 +0000 UTC',
        Type: 'Warning',
        ContainerAppName: 'shop-auth-service',
        RevisionName: 'shop-auth-service--r1',
        ReplicaName: 'shop-auth-service--r1-abc',
        Msg: 'Probe of StartUp failed with status code: 503',
        Reason: 'ProbeFailed',
        EventSource: 'ContainerAppController',
        Count: 1,
      });

      expect(parseAzureSystemStreamLine(line, SOURCE, NOW)).toMatchObject({
        time: '2026-11-10T12:00:01.000Z',
        source: 'auth-service',
        kind: 'platform',
        level: 'warn',
        message: 'ProbeFailed: Probe of StartUp failed with status code: 503',
      });
    });

    it('should write an event without a reason as its message', () => {
      expect(
        parseAzureSystemStreamLine(
          JSON.stringify({ Type: 'Normal', Msg: 'Replica started' }),
          SOURCE,
          NOW,
        ),
      ).toMatchObject({ level: 'info', message: 'Replica started' });
    });
  });

  describe('Edge cases', () => {
    it("should skip the stream's own connection notes", () => {
      for (const Msg of [
        'Connecting to the events collector...',
        'Successfully connected to events server',
      ]) {
        expect(
          parseAzureSystemStreamLine(
            JSON.stringify({ Type: 'Normal', Msg }),
            SOURCE,
            NOW,
          ),
        ).toBeUndefined();
      }
    });

    it('should skip lines that are not JSON or have no message', () => {
      expect(
        parseAzureSystemStreamLine('not json', SOURCE, NOW),
      ).toBeUndefined();
      expect(
        parseAzureSystemStreamLine(
          JSON.stringify({ Type: 'Normal' }),
          SOURCE,
          NOW,
        ),
      ).toBeUndefined();
    });
  });
});
