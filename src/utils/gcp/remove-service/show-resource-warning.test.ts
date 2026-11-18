import { describe, it, expect, rs } from '@rstest/core';

rs.mock('@tsdevstack/infra-core', () => ({ DB_EXPORT_RETENTION_DAYS: 7 }));

import { showResourceWarning } from './show-resource-warning';
import type { DiscoveredResources } from '../discovery';

describe('showResourceWarning', () => {
  const createMockLogger = () => ({
    newline: rs.fn(),
    warn: rs.fn(),
    info: rs.fn(),
  });

  const createEmptyDiscovery = (): DiscoveredResources => ({
    cloudRunService: false,
    cloudRunServiceName: 'test-service',
    migrationJobName: 'migrate-test-service',
    spaBucket: false,
    spaBucketName: '',
    secrets: [],
    database: false,
    databaseUser: false,
    serviceAccount: false,
    serviceAccountEmail: '',
    migrationServiceAccount: false,
    migrationServiceAccountEmail: '',
    inferredType: 'unknown',
    hasDatabase: false,
  });

  it('should show dry run message when dryRun is true', () => {
    const logger = createMockLogger();
    showResourceWarning({
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      coupledWorkers: [],
      targetEnv: 'dev',
      dryRun: true,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('WOULD DELETE'),
    );
  });

  it('should show permanent delete message when dryRun is false', () => {
    const logger = createMockLogger();
    showResourceWarning({
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      coupledWorkers: [],
      targetEnv: 'dev',
      dryRun: false,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('PERMANENTLY DELETE'),
    );
  });

  it('should show Cloud Run service when discovered', () => {
    const logger = createMockLogger();
    const discovered = createEmptyDiscovery();
    discovered.cloudRunService = true;

    showResourceWarning({
      serviceName: 'my-service',
      discovered,
      coupledWorkers: [],
      targetEnv: 'dev',
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Cloud Run'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('my-service'),
    );
  });

  it('should show SPA bucket when discovered', () => {
    const logger = createMockLogger();
    const discovered = createEmptyDiscovery();
    discovered.spaBucket = true;
    discovered.spaBucketName = 'my-spa-bucket';

    showResourceWarning({
      serviceName: 'test-service',
      discovered,
      coupledWorkers: [],
      targetEnv: 'dev',
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('SPA Bucket'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('my-spa-bucket'),
    );
  });

  it('should say the database is saved first', () => {
    const logger = createMockLogger();
    const discovered = createEmptyDiscovery();
    discovered.database = true;

    showResourceWarning({
      serviceName: 'test-service',
      discovered,
      coupledWorkers: [],
      targetEnv: 'dev',
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      '   Database:        test-service (PostgreSQL) ← saved first, the file kept 7 days',
    );
  });

  it('should warn that the data is lost with --skip-export', () => {
    const logger = createMockLogger();
    const discovered = createEmptyDiscovery();
    discovered.database = true;

    showResourceWarning({
      serviceName: 'test-service',
      discovered,
      coupledWorkers: [],
      targetEnv: 'dev',
      skipExport: true,
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      '   Database:        test-service (PostgreSQL) ← DATA LOST (--skip-export)',
    );
  });

  it('should show secrets count when discovered', () => {
    const logger = createMockLogger();
    const discovered = createEmptyDiscovery();
    discovered.secrets = ['secret-1', 'secret-2'];

    showResourceWarning({
      serviceName: 'test-service',
      discovered,
      coupledWorkers: [],
      targetEnv: 'dev',
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Secrets'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('2 found'),
    );
  });

  it('should show service account when discovered', () => {
    const logger = createMockLogger();
    const discovered = createEmptyDiscovery();
    discovered.serviceAccount = true;
    discovered.serviceAccountEmail = 'sa@project.iam.gserviceaccount.com';

    showResourceWarning({
      serviceName: 'test-service',
      discovered,
      coupledWorkers: [],
      targetEnv: 'dev',
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Service Account'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('sa@project.iam.gserviceaccount.com'),
    );
  });

  it("should show the migration jobs' account when discovered", () => {
    const logger = createMockLogger();
    const discovered = createEmptyDiscovery();
    discovered.migrationServiceAccount = true;
    discovered.migrationServiceAccountEmail =
      'p-test-service-mg@project.iam.gserviceaccount.com';

    showResourceWarning({
      serviceName: 'test-service',
      discovered,
      coupledWorkers: [],
      targetEnv: 'dev',
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Migrations SA:   p-test-service-mg@project.iam.gserviceaccount.com',
      ),
    );
  });

  it('should show coupled workers when present', () => {
    const logger = createMockLogger();

    showResourceWarning({
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      coupledWorkers: [
        { name: 'worker-1', cloudRunName: 'worker-1' },
        { name: 'worker-2', cloudRunName: 'worker-2' },
      ],
      targetEnv: 'dev',
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Coupled workers'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('worker-1'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('worker-2'),
    );
  });

  it('should show dependency warning', () => {
    const logger = createMockLogger();

    showResourceWarning({
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      coupledWorkers: [],
      targetEnv: 'dev',
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no other services depend'),
    );
  });
});
