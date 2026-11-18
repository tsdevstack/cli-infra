import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = rs.hoisted(() => ({
  isCIEnv: rs.fn(),
  setup: rs.fn(),
  gcpRestore: rs.fn(),
  awsRestore: rs.fn(),
  azureRestore: rs.fn(),
}));

rs.mock('../context', () => ({
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    isCIEnv: () => mocks.isCIEnv(),
  })),
}));
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: mocks.setup,
}));
rs.mock('../utils/gcp/commands/restore-database', () => ({
  gcpRestoreDatabase: mocks.gcpRestore,
}));
rs.mock('../utils/aws/commands/restore-database', () => ({
  awsRestoreDatabase: mocks.awsRestore,
}));
rs.mock('../utils/azure/commands/restore-database', () => ({
  azureRestoreDatabase: mocks.azureRestore,
}));

import { infraRestoreDatabase } from './infra-restore-database';

describe('infraRestoreDatabase', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.isCIEnv.mockReturnValue(false);
    mocks.setup.mockResolvedValue({ provider: 'gcp' });
    mocks.gcpRestore.mockResolvedValue(undefined);
  });

  describe('Standard use cases', () => {
    it('should restore on GCP with the file option', async () => {
      await infraRestoreDatabase('auth-service', {
        env: 'dev',
        file: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
      });

      expect(mocks.gcpRestore).toHaveBeenCalledWith({
        serviceName: 'auth-service',
        ctx: { provider: 'gcp' },
        runningInCI: false,
        fileOption: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
      });
    });

    it.each([
      ['aws', 'awsRestore'],
      ['azure', 'azureRestore'],
    ] as const)('should restore on %s', async (provider, restore) => {
      mocks.setup.mockResolvedValue({ provider });

      await infraRestoreDatabase('auth-service', { env: 'dev' });

      expect(mocks[restore]).toHaveBeenCalledWith({
        serviceName: 'auth-service',
        ctx: { provider },
        runningInCI: false,
        fileOption: undefined,
      });
      expect(mocks.gcpRestore).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should need the service name in CI', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(
        infraRestoreDatabase(undefined, { env: 'dev', confirm: true }),
      ).rejects.toMatchObject({ message: 'Service name required in CI mode' });
      expect(mocks.setup).not.toHaveBeenCalled();
    });

    it('should pass no name on in a terminal (the services are listed)', async () => {
      await infraRestoreDatabase(undefined, { env: 'dev' });

      expect(mocks.gcpRestore).toHaveBeenCalledWith(
        expect.objectContaining({ serviceName: undefined }),
      );
    });

    it('should need --confirm in CI', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(
        infraRestoreDatabase('auth-service', { env: 'dev' }),
      ).rejects.toMatchObject({
        message: '--confirm flag required in CI mode',
      });
      expect(mocks.setup).not.toHaveBeenCalled();
    });

    it('should refuse an unknown provider', async () => {
      mocks.setup.mockResolvedValue({ provider: 'other' });

      await expect(
        infraRestoreDatabase('auth-service', { env: 'dev' }),
      ).rejects.toMatchObject({
        message: 'Unsupported provider: other',
      });
    });
  });
});
