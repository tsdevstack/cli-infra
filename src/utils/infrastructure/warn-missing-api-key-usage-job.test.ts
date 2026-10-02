import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';
import type { FrameworkConfig } from '@tsdevstack/cli/plugin';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { warnMissingApiKeyUsageJob } from './warn-missing-api-key-usage-job';
import type { InfrastructureConfig } from './types';

const frameworkConfig = {
  project: { name: 'my-app', version: '1.0.0' },
  framework: { template: 'auth' },
  cloud: { provider: 'gcp' },
  services: [
    { name: 'auth-service', type: 'nestjs', globalPrefix: 'auth' },
    { name: 'offers-service', type: 'nestjs', globalPrefix: 'offers' },
  ],
} as FrameworkConfig;

function withJobs(jobs: unknown[]): InfrastructureConfig {
  return {
    version: '1.0.0',
    staging: { scheduledJobs: jobs },
  } as unknown as InfrastructureConfig;
}

describe('warnMissingApiKeyUsageJob', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.hasAuthTemplate.mockReturnValue(true);
    mocks.resolveGlobalPrefix.mockImplementation(
      (s: { globalPrefix?: string }) => s.globalPrefix ?? 'x',
    );
  });

  describe('Standard use cases', () => {
    it('should warn with the entry to add when the job is missing', () => {
      const warned = warnMissingApiKeyUsageJob({
        frameworkConfig,
        infraConfig: withJobs([
          {
            name: 'cleanup-tokens',
            schedule: '0 */4 * * *',
            targetService: 'auth-service',
            endpoint: '/auth/jobs/cleanup-tokens',
          },
        ]),
        environment: 'staging',
      });

      expect(warned).toBe(true);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'No scheduled job calls /auth/jobs/sync-api-key-usage on auth-service in "staging"',
        ),
      );
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        '   {"name":"sync-api-key-usage","schedule":"*/5 * * * *","targetService":"auth-service","endpoint":"/auth/jobs/sync-api-key-usage","method":"POST"}',
      );
    });

    it('should not warn when the environment has the job (any name)', () => {
      expect(
        warnMissingApiKeyUsageJob({
          frameworkConfig,
          infraConfig: withJobs([
            {
              name: 'key-usage',
              schedule: '*/10 * * * *',
              targetService: 'auth-service',
              endpoint: '/auth/jobs/sync-api-key-usage/',
            },
          ]),
          environment: 'staging',
        }),
      ).toBe(false);
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should warn without infrastructure.json or without the environment', () => {
      expect(
        warnMissingApiKeyUsageJob({
          frameworkConfig,
          infraConfig: null,
          environment: 'dev',
        }),
      ).toBe(true);
      expect(
        warnMissingApiKeyUsageJob({
          frameworkConfig,
          infraConfig: withJobs([]),
          environment: 'prod',
        }),
      ).toBe(true);
    });

    it('should use the auth-service global prefix', () => {
      mocks.resolveGlobalPrefix.mockReturnValue('identity');
      warnMissingApiKeyUsageJob({
        frameworkConfig,
        infraConfig: null,
        environment: 'dev',
      });
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('/identity/jobs/sync-api-key-usage'),
      );
    });

    it('should not count the endpoint on another service', () => {
      expect(
        warnMissingApiKeyUsageJob({
          frameworkConfig,
          infraConfig: withJobs([
            {
              name: 'sync-api-key-usage',
              schedule: '*/5 * * * *',
              targetService: 'offers-service',
              endpoint: '/auth/jobs/sync-api-key-usage',
            },
          ]),
          environment: 'staging',
        }),
      ).toBe(true);
    });

    it('should not check projects without the auth template', () => {
      mocks.hasAuthTemplate.mockReturnValue(false);
      expect(
        warnMissingApiKeyUsageJob({
          frameworkConfig,
          infraConfig: null,
          environment: 'dev',
        }),
      ).toBe(false);
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('should not check without an auth-service', () => {
      expect(
        warnMissingApiKeyUsageJob({
          frameworkConfig: { ...frameworkConfig, services: [] },
          infraConfig: null,
          environment: 'dev',
        }),
      ).toBe(false);
    });
  });
});
