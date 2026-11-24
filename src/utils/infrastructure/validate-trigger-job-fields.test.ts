import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateTriggerJobFields } from './validate-trigger-job-fields';

function trigger(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: 'cleanup-tokens',
    schedule: '0 3 * * *',
    targetService: 'auth-service',
    endpoint: '/auth/jobs/cleanup-tokens',
    ...overrides,
  };
}

describe('validateTriggerJobFields', () => {
  it('should accept a trigger with an endpoint only, on every cloud', () => {
    for (const provider of ['gcp', 'aws', 'azure'] as const) {
      expect(() =>
        validateTriggerJobFields('ctx', trigger(), provider),
      ).not.toThrow();
    }
  });

  it('should require the endpoint and point at cron jobs for code', () => {
    const { endpoint: _endpoint, ...noEndpoint } = trigger();
    expect(() => validateTriggerJobFields('ctx', noEndpoint, 'gcp')).toThrow(
      'ctx.endpoint is missing',
    );
    expect(() =>
      validateTriggerJobFields('ctx', trigger({ endpoint: '' }), 'gcp'),
    ).toThrow('ctx.endpoint is missing');
  });

  it('should refuse an unknown method', () => {
    expect(() =>
      validateTriggerJobFields('ctx', trigger({ method: 'FETCH' }), 'gcp'),
    ).toThrow();
  });

  it("should refuse an httpTimeout outside the cloud's limits", () => {
    expect(() =>
      validateTriggerJobFields('ctx', trigger({ httpTimeout: 1801 }), 'gcp'),
    ).toThrow(
      'ctx.httpTimeout: 1801 is not a whole number of seconds from 15 to 1800',
    );
    expect(() =>
      validateTriggerJobFields('ctx', trigger({ httpTimeout: 241 }), 'azure'),
    ).toThrow('from 15 to 240');
    expect(() =>
      validateTriggerJobFields('ctx', trigger({ httpTimeout: 14 }), 'aws'),
    ).toThrow('from 15 to 890');
  });
});
