import { describe, it, expect, rs } from '@rstest/core';

rs.mock('@tsdevstack/infra-core', () => ({ DB_EXPORT_RETENTION_DAYS: 7 }));

import { showResourceWarning } from './show-resource-warning';
import type { DiscoveredResources } from '../discovery';

describe('showResourceWarning (Azure)', () => {
  const createMockLogger = () => ({
    newline: rs.fn(),
    warn: rs.fn(),
    info: rs.fn(),
  });

  const createDiscovery = (
    overrides: Partial<DiscoveredResources> = {},
  ): DiscoveredResources => ({
    containerApp: false,
    vaultName: 'shop-dev-kv',
    serviceVaultName: 'shop-dev-auth-service',
    spaBucket: false,
    spaBucketName: '',
    secrets: [],
    serviceVaultSecrets: [],
    inferredType: 'unknown',
    hasDatabase: false,
    postgresServerName: 'shop-dev-postgres',
    ...overrides,
  });

  const show = (
    discovered: DiscoveredResources,
    options: { dryRun?: boolean; skipExport?: boolean } = {},
  ) => {
    const logger = createMockLogger();
    showResourceWarning({
      serviceName: 'auth-service',
      discovered,
      coupledWorkers: [],
      targetEnv: 'dev',
      logger,
      ...options,
    });
    return logger;
  };

  describe('Standard use cases', () => {
    it('should say what a dry run would delete', () => {
      const logger = show(createDiscovery(), { dryRun: true });

      expect(logger.warn).toHaveBeenCalledWith(
        'WARNING: This WOULD DELETE from dev:',
      );
    });

    it('should list the app, the secrets of both vaults, and the database', () => {
      const logger = show(
        createDiscovery({
          containerApp: true,
          secrets: ['a'],
          serviceVaultSecrets: ['b', 'c'],
          hasDatabase: true,
        }),
      );

      expect(logger.info).toHaveBeenCalledWith(
        '   Container App:   auth-service',
      );
      expect(logger.info).toHaveBeenCalledWith('   Secrets:         3 found');
    });

    it('should say the database is saved first', () => {
      const logger = show(createDiscovery({ hasDatabase: true }));

      expect(logger.info).toHaveBeenCalledWith(
        '   Database:        auth-service (PostgreSQL) ← saved first, the file kept 7 days',
      );
    });
  });

  describe('Edge cases', () => {
    it('should say the data is lost with --skip-export', () => {
      const logger = show(createDiscovery({ hasDatabase: true }), {
        skipExport: true,
      });

      expect(logger.info).toHaveBeenCalledWith(
        '   Database:        auth-service (PostgreSQL) ← DATA LOST (--skip-export)',
      );
    });

    it('should leave the database out when there is none', () => {
      const logger = show(createDiscovery());

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Database:'),
      );
    });
  });
});
