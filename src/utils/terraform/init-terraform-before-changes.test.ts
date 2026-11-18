import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockExecuteTerraform, mockExistsSync } = rs.hoisted(() => ({
  mockExecuteTerraform: rs.fn(),
  mockExistsSync: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  executeTerraform: mockExecuteTerraform,
}));
rs.mock('node:fs', () => ({
  default: { existsSync: mockExistsSync },
}));

class MockCliError extends Error {
  constructor(
    message: string,
    readonly context?: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}
const mockLogger = { info: rs.fn(), newline: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger, CliError: MockCliError }),
}));

import { initTerraformBeforeChanges } from './init-terraform-before-changes';

const options = {
  projectRoot: '/project',
  targetEnv: 'dev',
  env: { GOOGLE_APPLICATION_CREDENTIALS: '/creds.json' },
};

describe('initTerraformBeforeChanges', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockExecuteTerraform.mockResolvedValue({ success: true });
  });

  describe('Standard use cases', () => {
    it("should run init -reconfigure in the environment's folder with the cloud's credentials", async () => {
      await initTerraformBeforeChanges(options);

      expect(mockExecuteTerraform).toHaveBeenCalledWith('init', {
        workDir: '/project/infrastructure/terraform/dev',
        env: options.env,
        reconfigure: true,
      });
    });

    it('should stop the removal when init fails', async () => {
      mockExecuteTerraform.mockResolvedValue({
        success: false,
        error: 'Error: Failed to get existing workspaces',
      });

      await expect(initTerraformBeforeChanges(options)).rejects.toThrow(
        'Terraform init failed. Nothing was changed.',
      );
    });
  });

  describe('Edge cases', () => {
    it('should do nothing without the Terraform folder', async () => {
      mockExistsSync.mockReturnValue(false);

      await initTerraformBeforeChanges(options);

      expect(mockExecuteTerraform).not.toHaveBeenCalled();
    });
  });
});
