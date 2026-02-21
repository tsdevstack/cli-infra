import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { buildDeletionSteps } from './build-deletion-steps';
import type { DiscoveredResources, CoupledWorkerInfo } from '../discovery';
import type { GCPCommandContext } from '../commands/types';

// Mock all delete functions
rs.mock('../delete', () => ({
  deleteCloudRunService: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteBucket: rs.fn().mockResolvedValue({ success: true, deleted: true }),
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

rs.mock('./sync-terraform-state', () => ({
  syncTerraformState: rs.fn().mockResolvedValue(undefined),
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
    spaBucket: false,
    spaBucketName: '',
    secrets: [],
    database: false,
    databaseUser: false,
    serviceAccount: false,
    serviceAccountEmail: '',
    inferredType: 'unknown',
    hasDatabase: false,
  });

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should always include terraform state sync step', () => {
    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      dbPasswords: {},
      coupledWorkers: [],
    });

    const tfStep = steps.find((s) => s.name === 'Terraform state sync');
    expect(tfStep).toBeDefined();
    expect(tfStep?.resource).toBe('infrastructure state');
  });

  it('should always include shared secrets cleanup step', () => {
    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      dbPasswords: {},
      coupledWorkers: [],
    });

    const secretsStep = steps.find(
      (s) => s.name === 'Shared secrets for service',
    );
    expect(secretsStep).toBeDefined();
  });

  it('should add Cloud Run deletion step when service exists', () => {
    const discovered = createEmptyDiscovery();
    discovered.cloudRunService = true;

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'my-service',
      discovered,
      projectName: 'test-project',
      dbPasswords: {},
      coupledWorkers: [],
    });

    const cloudRunStep = steps.find((s) => s.name === 'Cloud Run service');
    expect(cloudRunStep).toBeDefined();
    expect(cloudRunStep?.resource).toBe('my-service');
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
      dbPasswords: {},
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
      dbPasswords: {},
      coupledWorkers: [],
    });

    const dbStep = steps.find((s) => s.name === 'Cloud SQL database');
    expect(dbStep).toBeDefined();
    expect(dbStep?.resource).toBe('auth-service');

    const userStep = steps.find((s) => s.name === 'Cloud SQL user');
    expect(userStep).toBeDefined();
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
      dbPasswords: {},
      coupledWorkers: [],
    });

    const saStep = steps.find((s) => s.name === 'Service Account');
    expect(saStep).toBeDefined();
    expect(saStep?.resource).toBe('sa@project.iam.gserviceaccount.com');
  });

  it('should add service-scoped secrets step when secrets exist', () => {
    const discovered = createEmptyDiscovery();
    discovered.secrets = ['secret-1'];

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered,
      projectName: 'test-project',
      dbPasswords: {},
      coupledWorkers: [],
    });

    const secretsStep = steps.find((s) => s.name === 'Service-scoped secrets');
    expect(secretsStep).toBeDefined();
    expect(secretsStep?.resource).toBe('1 secrets');
  });

  it('should add coupled worker deletion steps first', () => {
    const coupledWorkers: CoupledWorkerInfo[] = [
      { name: 'worker-1' },
      { name: 'worker-2' },
    ];

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered: createEmptyDiscovery(),
      projectName: 'test-project',
      dbPasswords: {},
      coupledWorkers,
    });

    // Workers should be first
    expect(steps[0].name).toBe('Coupled worker');
    expect(steps[0].resource).toBe('worker-1');
    expect(steps[1].name).toBe('Coupled worker');
    expect(steps[1].resource).toBe('worker-2');
  });

  it('should order steps correctly (workers, cloud run, bucket, db, user, sa, cdn, tf, secrets)', () => {
    const discovered: DiscoveredResources = {
      cloudRunService: true,
      spaBucket: true,
      spaBucketName: 'my-bucket',
      secrets: ['secret-1'],
      database: true,
      databaseUser: true,
      serviceAccount: true,
      serviceAccountEmail: 'sa@project.iam',
      inferredType: 'backend',
      hasDatabase: true,
    };

    const coupledWorkers: CoupledWorkerInfo[] = [{ name: 'worker-1' }];

    const steps = buildDeletionSteps({
      ctx: createMockContext(),
      serviceName: 'test-service',
      discovered,
      projectName: 'test-project',
      dbPasswords: {},
      coupledWorkers,
    });

    const stepNames = steps.map((s) => s.name);
    expect(stepNames).toEqual([
      'Coupled worker',
      'Cloud Run service',
      'SPA bucket',
      'Cloud SQL database',
      'Cloud SQL user',
      'Service Account',
      'CDN cache invalidation',
      'Terraform state sync',
      'Service-scoped secrets',
      'Shared secrets for service',
    ]);
  });
});
