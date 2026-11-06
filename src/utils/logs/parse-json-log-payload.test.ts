import { describe, it, expect } from '@rstest/core';
import { parseJsonLogPayload } from './parse-json-log-payload';

describe('parseJsonLogPayload', () => {
  describe('Standard use cases', () => {
    it('should read our pino lines and keep only the app fields', () => {
      expect(
        parseJsonLogPayload({
          level: 'error',
          time: '2026-10-30T12:00:00.000Z',
          pid: 1,
          hostname: 'h',
          service: 'auth-service',
          context: 'AuthService',
          msg: 'Login failed',
          error: { name: 'Error', message: 'boom' },
        }),
      ).toEqual({
        level: 'error',
        message: 'Login failed',
        fields: {
          context: 'AuthService',
          error: { name: 'Error', message: 'boom' },
        },
      });
    });

    it("should read another app's JSON by its message and level", () => {
      expect(
        parseJsonLogPayload({ message: 'hello', level: 'warning' }),
      ).toEqual({
        level: 'warn',
        message: 'hello',
      });
    });
  });

  describe('Edge cases', () => {
    it("should take the provider's level when the line has none", () => {
      expect(parseJsonLogPayload({ message: 'hello' }, 'ERROR')).toEqual({
        level: 'error',
        message: 'hello',
      });
    });

    it('should show JSON without a message as it is', () => {
      expect(parseJsonLogPayload({ a: 1 })).toEqual({
        level: undefined,
        message: '{"a":1}',
      });
    });

    it('should leave out fields when a pino line has only its own', () => {
      expect(parseJsonLogPayload({ level: 'info', msg: 'Started' })).toEqual({
        level: 'info',
        message: 'Started',
      });
    });
  });
});
