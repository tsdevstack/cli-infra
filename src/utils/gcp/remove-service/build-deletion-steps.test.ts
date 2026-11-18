import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { buildDeletionSteps } from './build-deletion-steps';
import { deleteServiceAccount } from '../delete';
import type { DiscoveredResources, CoupledWorkerInfo } from '../discovery';
import type { GCPCommandContext } from '../commands/types';

// Mock all delete functions
rs.mock('../delete', () => ({
  dropDatabaseRoles: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteCloudRunService: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteBucket: rs.fn().mockResolvedValue({ success: true, deleted: true }),
  deleteCloudRunJob: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteSecretsByPrefix: rs
    .fn()
    .mockResolvedValue({ success: true, totalDeleted: 1 }),
  deleteSharedSecretsForService: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: ['secret1'] }),
  deleteDatabase: rs.fn().mockResolvedValue({ success: true, deleted: true }),
  deleteDatabaseUser: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteServiceAccount: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  invalidateCdnCache: rs.fn().mockResolvedValue({ success: true }),
}));

describe('buildDeletionSteps', () => {
  const createMockContext = (): GCPCommandContext => ({
    projectName: 'test-project',
    projectRoot: '/path/to/project',
    targetEnv: 'dev',
    runningInCI: false,
    credentials: {
      project_id: 'test-project-123',
      region: 'us-central1',
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: 'test-key',
    },
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

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it("should leave Terraform's state alone (every later run refreshes it)", () => {
    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      coupledWorkers: [],
    });

    expect(steps.map((s) => s.name)).not.toContain('Terraform state sync');
  });

  it('should always include shared secrets cleanup step', () => {
    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      coupledWorkers: [],
    });

    const secretsStep = steps.find(
      (s) => s.name === 'Shared secrets for service',
    );
    expect(secretsStep).toBeDefined();
  });

  it('should delete the service by its Cloud Run name', () => {
    const discovered = createEmptyDiscovery();
    discovered.cloudRunService = true;
    discovered.cloudRunServiceName = 'test-project-my-service';

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'my-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
    });

    const cloudRunStep = steps.find((s) => s.name === 'Cloud Run service');
    expect(cloudRunStep).toBeDefined();
    expect(cloudRunStep?.resource).toBe('test-project-my-service');
  });

  it('should add SPA bucket and CDN steps when bucket exists', () => {
    const discovered = createEmptyDiscovery();
    discovered.spaBucket = true;
    discovered.spaBucketName = 'my-bucket';

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
    });

    const bucketStep = steps.find((s) => s.name === 'SPA bucket');
    expect(bucketStep).toBeDefined();
    expect(bucketStep?.resource).toBe('my-bucket');

    const cdnStep = steps.find((s) => s.name === 'CDN cache invalidation');
    expect(cdnStep).toBeDefined();
  });

  it('should add database and user deletion steps when database exists', () => {
    const discovered = createEmptyDiscovery();
    discovered.database = true;
    discovered.databaseUser = true;

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'auth-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
    });

    const dbStep = steps.find((s) => s.name === 'Cloud SQL database');
    expect(dbStep).toBeDefined();
    expect(dbStep?.resource).toBe('auth-service');

    const userStep = steps.find((s) => s.name === 'Cloud SQL user');
    expect(userStep).toBeDefined();
  });

  it('should save the database right before it is dropped, after the migration job', async () => {
    const discovered = createEmptyDiscovery();
    discovered.database = true;
    discovered.cloudRunService = true;
    const saveDatabase = rs.fn(async () => ({ success: true, deleted: true }));

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'auth-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
      saveDatabase,
    });

    const names = steps.map((step) => step.name);
    const save = names.indexOf('Database save');
    expect(save).toBeGreaterThan(names.indexOf('Cloud Run service'));
    expect(save).toBeGreaterThan(names.indexOf('Migration job'));
    expect(names[save + 1]).toBe('Database and roles');

    const step = steps[save];
    expect(step.label).toBe('Saving the database');
    expect(step.doneText).toBe('Saved');
    await step.execute();
    expect(saveDatabase).toHaveBeenCalledTimes(1);
  });

  it('should not save without a database or with --skip-export', () => {
    const withoutDatabase = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      coupledWorkers: [],
      saveDatabase: async () => ({ success: true, deleted: true }),
    });
    const discovered = createEmptyDiscovery();
    discovered.database = true;
    const skipExport = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'auth-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
    });

    for (const steps of [withoutDatabase, skipExport]) {
      expect(steps.some((step) => step.name === 'Database save')).toBe(false);
    }
  });

  it('should delete the migration job of a service with a database', () => {
    const discovered = createEmptyDiscovery();
    discovered.database = true;
    discovered.migrationJobName = 'migrate-auth-service';

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'auth-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
    });

    const jobStep = steps.find((s) => s.name === 'Migration job');
    expect(jobStep?.resource).toBe('migrate-auth-service');
  });

  it('should not look for a migration job without a database', () => {
    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'frontend',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      coupledWorkers: [],
    });

    expect(steps.some((s) => s.name === 'Migration job')).toBe(false);
  });

  it('should add service account deletion step when it exists', () => {
    const discovered = createEmptyDiscovery();
    discovered.serviceAccount = true;
    discovered.serviceAccountEmail = 'sa@project.iam.gserviceaccount.com';

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
    });

    const saStep = steps.find((s) => s.name === 'Service Account');
    expect(saStep).toBeDefined();
    expect(saStep?.resource).toBe('sa@project.iam.gserviceaccount.com');
  });

  it("should delete the migration jobs' account after the runtime one", async () => {
    const discovered = createEmptyDiscovery();
    discovered.serviceAccount = true;
    discovered.serviceAccountEmail = 'sa@project.iam.gserviceaccount.com';
    discovered.migrationServiceAccount = true;
    discovered.migrationServiceAccountEmail =
      'test-project-test-service-mg@test-project-123.iam.gserviceaccount.com';

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
    });

    const names = steps.map((s) => s.name);
    expect(names.indexOf('Migrations service account')).toBe(
      names.indexOf('Service Account') + 1,
    );
    const step = steps.find((s) => s.name === 'Migrations service account');
    expect(step?.resource).toBe(discovered.migrationServiceAccountEmail);

    await step?.execute();
    expect(deleteServiceAccount).toHaveBeenCalledWith({
      serviceAccountEmail: discovered.migrationServiceAccountEmail,
      projectId: 'test-project-123',
      credentials: createMockContext().credentials,
    });
  });

  it("should not add the migration jobs' account step when there is none", () => {
    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      coupledWorkers: [],
    });

    expect(steps.some((s) => s.name === 'Migrations service account')).toBe(
      false,
    );
  });

  it('should add service-scoped secrets step when secrets exist', () => {
    const discovered = createEmptyDiscovery();
    discovered.secrets = ['secret-1'];

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers: [],
    });

    const secretsStep = steps.find((s) => s.name === 'Service-scoped secrets');
    expect(secretsStep).toBeDefined();
    expect(secretsStep?.resource).toBe('1 secrets');
  });

  it('should add coupled worker deletion steps first', () => {
    const coupledWorkers: CoupledWorkerInfo[] = [
      { name: 'worker-1', cloudRunName: 'worker-1' },
      { name: 'worker-2', cloudRunName: 'worker-2' },
    ];

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      coupledWorkers,
    });

    // Workers should be first
    expect(steps[0].name).toBe('Coupled worker');
    expect(steps[0].resource).toBe('worker-1');
    expect(steps[1].name).toBe('Coupled worker');
    expect(steps[1].resource).toBe('worker-2');
  });

  it('should order steps correctly (workers, cloud run, bucket, db, user, roles, sa, migrations sa, cdn, tf, secrets)', () => {
    const discovered: DiscoveredResources = {
      cloudRunService: true,
      cloudRunServiceName: 'test-service',
      migrationJobName: 'migrate-test-service',
      spaBucket: true,
      spaBucketName: 'my-bucket',
      secrets: ['secret-1'],
      database: true,
      databaseUser: true,
      serviceAccount: true,
      serviceAccountEmail: 'sa@project.iam',
      migrationServiceAccount: true,
      migrationServiceAccountEmail: 'mg@project.iam',
      inferredType: 'backend',
      hasDatabase: true,
    };

    const coupledWorkers: CoupledWorkerInfo[] = [
      { name: 'worker-1', cloudRunName: 'worker-1' },
    ];

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered,
      projectName: 'test-project',
      coupledWorkers,
    });

    const stepNames = steps.map((s) => s.name);
    expect(stepNames).toEqual([
      'Coupled worker',
      'Cloud Run service',
      'SPA bucket',
      'Migration job',
      'Database and roles',
      'Cloud SQL database',
      'Cloud SQL user',
      'Service Account',
      'Migrations service account',
      'CDN cache invalidation',
      'Service-scoped secrets',
      'Shared secrets for service',
    ]);
  });
});
