import { describe, it, expect } from '@rstest/core';
import { normalizeAzureLogRow } from './normalize-azure-log-row';

const TIME = new Date('2026-10-30T12:00:01.123Z');

describe('normalizeAzureLogRow', () => {
  describe('Standard use cases', () => {
    it('should read our pino JSON lines', () => {
      const raw = { ContainerAppName: 'shop-auth-service' };
      expect(
        normalizeAzureLogRow({
          TimeGenerated: TIME,
          Source: 'auth-service',
          Kind: 'app',
          Level: '',
          Text: JSON.stringify({
            level: 'warn',
            msg: 'Slow query',
            context: 'Db',
          }),
          Raw: raw,
        }),
      ).toEqual({
        time: '2026-10-30T12:00:01.123Z',
        source: 'auth-service',
        kind: 'app',
        level: 'warn',
        message: 'Slow query',
        fields: { context: 'Db' },
        raw,
      });
    });

    it('should read plain text output without a level', () => {
      const line = normalizeAzureLogRow({
        TimeGenerated: TIME,
        Source: 'kong',
        Kind: 'app',
        Level: '',
        Text: '2026/10/30 12:00:01 [notice] 1#0: start\n',
        Raw: {},
      });
      expect(line.message).toBe('2026/10/30 12:00:01 [notice] 1#0: start');
      expect(line.level).toBeUndefined();
    });

    it("should read platform lines with the platform's level", () => {
      expect(
        normalizeAzureLogRow({
          TimeGenerated: '2026-10-30T12:00:01.123Z',
          Source: 'auth-service',
          Kind: 'platform',
          Level: 'Warning',
          Text: 'ProbeFailed: Probe of StartUp failed',
          Raw: {},
        }),
      ).toMatchObject({
        time: '2026-10-30T12:00:01.123Z',
        kind: 'platform',
        level: 'warn',
        message: 'ProbeFailed: Probe of StartUp failed',
      });
    });

    it('should build edge lines from the Front Door row', () => {
      expect(
        normalizeAzureLogRow({
          TimeGenerated: TIME,
          Source: 'edge',
          Kind: 'edge',
          Level: '',
          Text: '',
          Raw: JSON.stringify({
            Category: 'FrontDoorAccessLog',
            httpMethod_s: 'GET',
            requestUri_s: 'https://api.example.com/auth/v1/me',
            httpStatusCode_s: '200',
          }),
        }),
      ).toMatchObject({
        kind: 'edge',
        level: 'info',
        message: 'GET api.example.com/auth/v1/me 200',
      });
    });
  });

  describe('Edge cases', () => {
    it('should treat an unknown kind as platform', () => {
      expect(
        normalizeAzureLogRow({
          TimeGenerated: TIME,
          Source: 'x',
          Kind: 'other',
          Text: 'hi',
        }).kind,
      ).toBe('platform');
    });
  });
});
