import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('./generate-terraform-files', () => ({
  generateTerraformFiles: rs.fn(),
}));

import { awsGenerate } from './generate';
import { generateTerraformFiles } from './generate-terraform-files';

describe('awsGenerate', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(generateTerraformFiles).mockReturnValue({
      outputDir: '/test/project/infrastructure/terraform/dev',
      generateConfig: {} as never,
      servicesWithDatabase: [],
    });
  });

  it('should call generateTerraformFiles with verbose option', async () => {
    await awsGenerate(mockCtx);

    expect(generateTerraformFiles).toHaveBeenCalledWith(
      mockCtx,
      'infra:generate',
      { verbose: true },
    );
  });

  it('should log project info', async () => {
    await awsGenerate(mockCtx);

    expect(mocks.logger.info).toHaveBeenCalledWith('Project: my-app');
    expect(mocks.logger.info).toHaveBeenCalledWith('Environment: dev');
  });

  it('should log completion and next steps', async () => {
    await awsGenerate(mockCtx);

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'Configuration files generated!',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('infra:plan'),
    );
  });
});
