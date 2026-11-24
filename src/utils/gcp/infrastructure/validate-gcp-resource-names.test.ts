import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';
import type { FrameworkService } from '@tsdevstack/cli/plugin';

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateGcpResourceNames } from './validate-gcp-resource-names';

const services: FrameworkService[] = [
  { name: 'auth-service', type: 'nestjs', hasDatabase: true },
  { name: 'frontend', type: 'nextjs' },
];

function options(overrides: Record<string, unknown> = {}) {
  return {
    projectName: 'myapp',
    environment: 'dev',
    gcpProjectId: 'my-gcp-project',
    naming: 'unique' as const,
    services,
    storageBuckets: ['avatars'],
    commandName: 'infra:generate',
    ...overrides,
  };
}

describe('validateGcpResourceNames', () => {
  describe('Standard use cases', () => {
    it('should accept names that fit', () => {
      expect(() => validateGcpResourceNames(options())).not.toThrow();
    });

    it('should not check a legacy environment, which keeps its names', () => {
      expect(() =>
        validateGcpResourceNames(
          options({ naming: 'legacy', projectName: 'p'.repeat(40) }),
        ),
      ).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should stop on a migration job name over 49 characters', () => {
      // 'p' x 20 + '-migrate-' + 'auth-service' = 41; 'p' x 30 makes 51
      expect(() =>
        validateGcpResourceNames(options({ projectName: 'p'.repeat(30) })),
      ).toThrow(
        `Cloud Run name "${'p'.repeat(30)}-migrate-auth-service" is 51 characters; Cloud Run takes at most 49`,
      );
    });

    it('should accept a name of exactly 49 characters', () => {
      // 'p' x 36 + '-' + 'auth-service' = 49; no database, so no job
      expect(() =>
        validateGcpResourceNames(
          options({
            projectName: 'p'.repeat(36),
            services: [{ name: 'auth-service', type: 'nestjs' }],
            storageBuckets: [],
          }),
        ),
      ).not.toThrow();
    });

    it('should stop on a bucket name over 63 characters', () => {
      expect(() =>
        validateGcpResourceNames(
          options({ services: [], storageBuckets: ['b'.repeat(50)] }),
        ),
      ).toThrow('GCS takes at most 63');
    });
  });
  describe('Cron jobs', () => {
    it("should stop on a cron job's Cloud Run Job name over 49 characters, in both schemes", () => {
      // 'myapp-cron-' is 11 characters: a 39-character name makes 50
      expect(() =>
        validateGcpResourceNames(options({ cronJobNames: ['a'.repeat(39)] })),
      ).toThrow(
        `Cloud Run Job name "myapp-cron-${'a'.repeat(39)}" is 50 characters; Cloud Run takes at most 49`,
      );
      // 'cron-' is 5: a legacy environment is checked too, since the job is new
      expect(() =>
        validateGcpResourceNames(
          options({ naming: 'legacy', cronJobNames: ['a'.repeat(45)] }),
        ),
      ).toThrow('is 50 characters');
    });

    it('should accept a cron job name that fits', () => {
      expect(() =>
        validateGcpResourceNames(options({ cronJobNames: ['a'.repeat(38)] })),
      ).not.toThrow();
    });
  });
});
