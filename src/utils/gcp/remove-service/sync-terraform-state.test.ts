import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { syncTerraformState } from './sync-terraform-state';
import type { GCPCommandContext } from '../commands/types';

// Mock dependencies
const mockLogger = {
  info: rs.fn(),
  success: rs.fn(),
  warn: rs.fn(),
};

rs.mock('../../../context', () => ({
  getContext: () => ({
    logger: mockLogger,
  }),
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(),
  },
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: rs.fn(() => ({
    GOOGLE_PROJECT: 'test-project',
    GOOGLE_REGION: 'us-central1',
  })),
}));

rs.mock('./run-terraform', () => ({
  runTerraform: rs.fn(),
}));

import fs from 'node:fs';
import { runTerraform } from './run-terraform';

describe('syncTerraformState', () => {
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

  beforeEach(() => {
    rs.clearAllMocks();
    // Reset process.env mock
    rs.stubGlobal('process', {
      ...process,
      env: { HOME: '/home/user' },
    });
  });

  it('should skip sync when terraform directory does not exist', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await syncTerraformState(createMockContext(), {});

    expect(mockLogger.info).toHaveBeenCalledWith(
      '  Terraform directory not found, skipping state sync',
    );
    expect(runTerraform).not.toHaveBeenCalled();
  });

  it('should run terraform init, plan and apply when directory exists', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(runTerraform).mockResolvedValue(undefined);

    await syncTerraformState(createMockContext(), {});

    expect(runTerraform).toHaveBeenCalledTimes(3);
    expect(runTerraform).toHaveBeenNthCalledWith(
      1,
      ['init', '-input=false', '-reconfigure'],
      '/path/to/project/infrastructure/terraform/dev',
      expect.any(Object),
    );
    expect(runTerraform).toHaveBeenNthCalledWith(
      2,
      ['plan', '-refresh-only', '-out=refresh.plan', '-input=false'],
      '/path/to/project/infrastructure/terraform/dev',
      expect.any(Object),
    );
    expect(runTerraform).toHaveBeenNthCalledWith(
      3,
      ['apply', '-input=false', 'refresh.plan'],
      '/path/to/project/infrastructure/terraform/dev',
      expect.any(Object),
    );
  });

  it('should inject database passwords into terraform environment', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(runTerraform).mockResolvedValue(undefined);

    const dbPasswords = {
      auth_service: 'auth-pass-123',
      offers_service: 'offers-pass-456',
    };

    await syncTerraformState(createMockContext(), dbPasswords);

    const envArg = rs.mocked(runTerraform).mock.calls[0][2];
    expect(envArg['TF_VAR_db_auth_service_password']).toBe('auth-pass-123');
    expect(envArg['TF_VAR_db_offers_service_password']).toBe('offers-pass-456');
  });

  it('should log success message on completion', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(runTerraform).mockResolvedValue(undefined);

    await syncTerraformState(createMockContext(), {});

    expect(mockLogger.success).toHaveBeenCalledWith(
      '  ✔ Terraform state synced',
    );
  });

  it('should throw error and log warning when terraform fails', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(runTerraform).mockRejectedValue(new Error('Terraform failed'));

    await expect(syncTerraformState(createMockContext(), {})).rejects.toThrow(
      'Terraform failed',
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Terraform state sync failed'),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('terraform plan -refresh-only'),
    );
  });

  it('should log number of pre-fetched passwords', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(runTerraform).mockResolvedValue(undefined);

    await syncTerraformState(createMockContext(), {
      auth_service: 'pass1',
      offers_service: 'pass2',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      '  Using 2 pre-fetched database password(s)',
    );
  });
});
