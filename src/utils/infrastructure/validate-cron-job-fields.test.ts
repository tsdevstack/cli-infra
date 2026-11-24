import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateCronJobFields } from './validate-cron-job-fields';

function cron(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: 'usage-report',
    type: 'cron',
    schedule: '0 3 * * *',
    targetService: 'auth-service',
    ...overrides,
  };
}

function hintOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { hint?: string }).hint;
  }
  return undefined;
}

describe('validateCronJobFields', () => {
  describe('Standard use cases', () => {
    it('should accept a cron job with only the required fields on every cloud', () => {
      for (const provider of ['gcp', 'aws', 'azure'] as const) {
        expect(() =>
          validateCronJobFields(
            'dev.scheduledJobs.usage-report',
            cron(),
            provider,
          ),
        ).not.toThrow();
      }
    });

    it("should accept each cloud's own timeout limit", () => {
      expect(() =>
        validateCronJobFields('ctx', cron({ timeout: 604740 }), 'gcp'),
      ).not.toThrow();
      expect(() =>
        validateCronJobFields('ctx', cron({ timeout: 86400 }), 'aws'),
      ).not.toThrow();
      expect(() =>
        validateCronJobFields('ctx', cron({ timeout: 86400 }), 'azure'),
      ).not.toThrow();
    });

    it("should accept the migration job's cpu and memory values", () => {
      expect(() =>
        validateCronJobFields('ctx', cron({ cpu: '2', memory: '4Gi' }), 'gcp'),
      ).not.toThrow();
      expect(() =>
        validateCronJobFields(
          'ctx',
          cron({ cpu: '1024', memory: '2048' }),
          'aws',
        ),
      ).not.toThrow();
      expect(() =>
        validateCronJobFields(
          'ctx',
          cron({ cpu: '1', memory: '2Gi' }),
          'azure',
        ),
      ).not.toThrow();
    });
  });

  describe('Names', () => {
    it.each([
      'Usage',
      'usage_report',
      '-usage',
      'usage-',
      'usage--report',
      '1usage',
    ])('should refuse %s', (name) => {
      expect(() => validateCronJobFields('ctx', cron({ name }), 'gcp')).toThrow(
        `ctx.name: "${name}" must be kebab-case`,
      );
    });

    it('should refuse a name over 40 characters', () => {
      expect(() =>
        validateCronJobFields('ctx', cron({ name: 'a'.repeat(41) }), 'gcp'),
      ).toThrow('at most 40 characters');
    });
  });

  describe('Timeout', () => {
    it('should refuse a timeout over the cloud limit, with the reason', () => {
      expect(() =>
        validateCronJobFields('ctx', cron({ timeout: 604741 }), 'gcp'),
      ).toThrow(
        'ctx.timeout: 604741 is not a whole number of seconds from 1 to 604740',
      );
      expect(
        hintOf(() =>
          validateCronJobFields('ctx', cron({ timeout: 86401 }), 'aws'),
        ),
      ).toContain('ECS has no limit of its own');
      expect(
        hintOf(() =>
          validateCronJobFields('ctx', cron({ timeout: 86401 }), 'azure'),
        ),
      ).toContain('Container Apps document no limit');
    });

    it('should refuse zero, a fraction and a string', () => {
      for (const timeout of [0, 1.5, '600']) {
        expect(() =>
          validateCronJobFields('ctx', cron({ timeout }), 'gcp'),
        ).toThrow('is not a whole number of seconds');
      }
    });
  });

  describe('CPU and memory', () => {
    it("should refuse a value the migration job doesn't take", () => {
      expect(() =>
        validateCronJobFields('ctx', cron({ cpu: '3' }), 'gcp'),
      ).toThrow();
      expect(() =>
        validateCronJobFields('ctx', cron({ cpu: '1' }), 'aws'),
      ).toThrow();
      expect(() =>
        validateCronJobFields('ctx', cron({ memory: '3Gi' }), 'azure'),
      ).toThrow();
    });

    it('should refuse a pair Azure does not run, saying the other value is the default', () => {
      // 4 vCPU with the default 2Gi
      expect(() =>
        validateCronJobFields('ctx', cron({ cpu: '4' }), 'azure'),
      ).toThrow('"4/2Gi" in ctx (memory 2Gi is the default)');
      expect(() =>
        validateCronJobFields('ctx', cron({ memory: '0.5Gi' }), 'azure'),
      ).toThrow('"1/0.5Gi" in ctx (cpu 1 is the default)');
    });

    it('should refuse a pair Fargate does not run, in ECS units', () => {
      // 4096 units (4 vCPU) with the default 2048 MiB
      expect(() =>
        validateCronJobFields('ctx', cron({ cpu: '4096' }), 'aws'),
      ).toThrow('"4/2048Mi" in ctx (memory 2048 is the default)');
      expect(() =>
        validateCronJobFields(
          'ctx',
          cron({ cpu: '512', memory: '1024' }),
          'aws',
        ),
      ).not.toThrow();
    });
  });
});
