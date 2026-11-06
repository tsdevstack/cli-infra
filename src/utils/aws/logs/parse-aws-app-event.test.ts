import { describe, it, expect } from '@rstest/core';
import { parseAwsAppEvent } from './parse-aws-app-event';

const TIME = Date.UTC(2026, 9, 30, 12, 0, 1, 123);

describe('parseAwsAppEvent', () => {
  const source = { name: 'auth-service', type: 'service' as const };

  it('should read our pino JSON lines', () => {
    const event = {
      timestamp: TIME,
      message: JSON.stringify({
        level: 'error',
        time: '2026-10-30T12:00:01.100Z',
        service: 'auth-service',
        context: 'AuthService',
        msg: 'Login failed',
      }),
    };
    expect(parseAwsAppEvent(event, source)).toEqual({
      time: '2026-10-30T12:00:01.123Z',
      source: 'auth-service',
      kind: 'app',
      level: 'error',
      message: 'Login failed',
      fields: { context: 'AuthService' },
      raw: event,
    });
  });

  it('should read plain text without a level', () => {
    const line = parseAwsAppEvent(
      { timestamp: TIME, message: '2026/10/30 12:00:01 [notice] 1#0: start\n' },
      { name: 'kong', type: 'kong' },
    );
    expect(line).toMatchObject({
      source: 'kong',
      kind: 'app',
      message: '2026/10/30 12:00:01 [notice] 1#0: start',
    });
    expect(line.level).toBeUndefined();
  });

  it('should read text that only starts like JSON as text', () => {
    expect(
      parseAwsAppEvent({ timestamp: TIME, message: '{oops' }, source).message,
    ).toBe('{oops');
  });
});
