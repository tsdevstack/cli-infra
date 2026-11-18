import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = rs.hoisted(() => ({
  chooseService: rs.fn(),
  prompt: rs.fn(),
  initTerraform: rs.fn(),
  databaseExists: rs.fn(),
  getBucket: rs.fn(),
  listExports: rs.fn(),
  runJob: rs.fn(),
}));

rs.mock('inquirer', () => ({ default: { prompt: mocks.prompt } }));
rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: () => ({}),
  DB_EXPORT_REASONS: { removed: 'removed', beforeRestore: 'before-restore' },
  DB_EXPORT_FILE_EXTENSION: '.dump',
  DB_EXPORT_RETENTION_DAYS: 7,
}));
rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('../../terraform', () => ({
  initTerraformBeforeChanges: mocks.initTerraform,
}));
rs.mock('../discovery', () => ({
  listSecretsByPrefix: mocks.databaseExists,
}));
rs.mock('../database-export/get-aws-db-exports-bucket', () => ({
  getAwsDbExportsBucket: mocks.getBucket,
}));
rs.mock('../database-export/list-aws-db-exports', () => ({
  listAwsDbExports: mocks.listExports,
}));
rs.mock('../database-export/run-aws-database-job', () => ({
  runAwsDatabaseJob: mocks.runJob,
}));
rs.mock('../../database-export/choose-db-export-service', () => ({
  chooseDbExportService: mocks.chooseService,
}));

import { awsRestoreDatabase } from './restore-database';
import type { AWSCommandContext } from './types';

const context = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const ctx = {
  projectName: 'shop',
  projectRoot: '/p',
  targetEnv: 'dev',
  credentials: {
    accountId: '123456789012',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret',
    region: 'eu-west-1',
  },
} as unknown as AWSCommandContext;

const removed = {
  name: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
  serviceName: 'auth-service',
  time: new Date('2026-11-14T12:30:00Z'),
  reason: 'removed' as const,
  size: 4096,
};

describe('awsRestoreDatabase', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.initTerraform.mockResolvedValue(undefined);
    mocks.getBucket.mockReturnValue('shop-db-exports-123456789012');
    mocks.databaseExists.mockResolvedValue({
      success: true,
      secrets: [{ name: 'shop-auth-service-DATABASE_URL', arn: 'arn:x' }],
    });
    mocks.listExports.mockResolvedValue([removed]);
    mocks.runJob.mockResolvedValue(undefined);
    mocks.prompt.mockResolvedValue({ proceed: true });
  });

  describe('Standard use cases', () => {
    it('should save the current contents first, then restore the newest file from a removal', async () => {
      await awsRestoreDatabase({
        serviceName: 'auth-service',
        ctx,
        runningInCI: true,
      });

      expect(mocks.runJob).toHaveBeenCalledTimes(2);
      expect(mocks.runJob.mock.calls[0][0]).toMatchObject({
        mode: 'export',
        serviceName: 'auth-service',
        file: expect.stringMatching(/^auth-service\/.*-before-restore\.dump$/),
      });
      expect(mocks.runJob.mock.calls[1][0]).toMatchObject({
        mode: 'restore',
        serviceName: 'auth-service',
        file: removed.name,
      });
      expect(mocks.prompt).not.toHaveBeenCalled();
    });

    it('should list the services with saved files when none is named', async () => {
      mocks.chooseService.mockResolvedValue('auth-service');

      await awsRestoreDatabase({
        serviceName: undefined,
        ctx,
        runningInCI: false,
      });

      // The whole bucket for the list, then the chosen service's files
      expect(mocks.listExports.mock.calls[0][0]).not.toHaveProperty(
        'serviceName',
      );
      expect(mocks.chooseService).toHaveBeenCalledWith([removed]);
      expect(mocks.listExports.mock.calls[1][0]).toMatchObject({
        serviceName: 'auth-service',
      });
      expect(mocks.runJob.mock.calls[1][0]).toMatchObject({
        mode: 'restore',
        serviceName: 'auth-service',
      });
    });

    it('should set up Terraform first, for this command', async () => {
      await awsRestoreDatabase({
        serviceName: 'auth-service',
        ctx,
        runningInCI: true,
      });

      expect(mocks.initTerraform).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'infra:restore-database' }),
      );
    });

    it('should change nothing when the user says no', async () => {
      mocks.prompt.mockResolvedValue({ proceed: false });

      await awsRestoreDatabase({
        serviceName: 'auth-service',
        ctx,
        runningInCI: false,
      });

      expect(mocks.runJob).not.toHaveBeenCalled();
      expect(context.logger.info).toHaveBeenCalledWith('Nothing was changed.');
    });
  });

  describe('Edge cases', () => {
    it('should stop before anything without the exports bucket', async () => {
      mocks.getBucket.mockReturnValue(null);

      await expect(
        awsRestoreDatabase({
          serviceName: 'auth-service',
          ctx,
          runningInCI: true,
        }),
      ).rejects.toMatchObject({
        message: 'This environment has no bucket for saved databases yet',
      });
      expect(mocks.runJob).not.toHaveBeenCalled();
    });

    it("should look for the service's DATABASE_URL (RDS lists no databases)", async () => {
      await awsRestoreDatabase({
        serviceName: 'auth-service',
        ctx,
        runningInCI: true,
      });

      expect(mocks.databaseExists).toHaveBeenCalledWith({
        prefix: 'shop-auth-service-',
        credentials: ctx.credentials,
      });
    });

    it("should stop when the secrets can't be read", async () => {
      mocks.databaseExists.mockResolvedValue({
        success: false,
        secrets: [],
        error: 'AccessDenied',
      });

      await expect(
        awsRestoreDatabase({
          serviceName: 'auth-service',
          ctx,
          runningInCI: true,
        }),
      ).rejects.toMatchObject({
        message: 'Could not check the database of auth-service: AccessDenied',
      });
      expect(mocks.runJob).not.toHaveBeenCalled();
    });

    it('should ask to deploy the service first when it has no database', async () => {
      mocks.databaseExists.mockResolvedValue({ success: true, secrets: [] });

      await expect(
        awsRestoreDatabase({
          serviceName: 'auth-service',
          ctx,
          runningInCI: true,
        }),
      ).rejects.toMatchObject({
        message: 'auth-service has no database in dev',
        hint: expect.stringContaining('infra:deploy --env dev'),
      });
      expect(mocks.runJob).not.toHaveBeenCalled();
    });

    it('should not restore when saving the current contents fails', async () => {
      mocks.runJob.mockRejectedValueOnce(new Error('db-init (export) failed'));

      await expect(
        awsRestoreDatabase({
          serviceName: 'auth-service',
          ctx,
          runningInCI: true,
        }),
      ).rejects.toThrow('db-init (export) failed');
      expect(mocks.runJob).toHaveBeenCalledTimes(1);
    });
  });
});
