import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { pushAwsKongImage } from './push-kong-image';

rs.mock('../../../context', () => ({
  getContext: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  configureEcrAuth: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(),
}));

import { getContext } from '../../../context';
import { configureEcrAuth } from '@tsdevstack/infra-core';
import { execSync } from 'node:child_process';

describe('pushAwsKongImage', () => {
  const mockLogger = {
    generating: rs.fn(),
    success: rs.fn(),
  };

  const mockCredentials = {
    accountId: '123456789012',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    region: 'us-east-1',
  };

  beforeEach(() => {
    rs.mocked(getContext).mockReturnValue({
      logger: mockLogger,
    } as unknown as ReturnType<typeof getContext>);
    rs.mocked(configureEcrAuth).mockResolvedValue();
  });

  it('should configure ECR auth before pushing', async () => {
    const registryUrl = '123456789.dkr.ecr.us-east-1.amazonaws.com/my-project';

    await pushAwsKongImage(
      `${registryUrl}/kong:v1.0.0`,
      registryUrl,
      mockCredentials,
    );

    expect(configureEcrAuth).toHaveBeenCalledWith(
      expect.anything(),
      mockCredentials,
      registryUrl,
    );
    expect(configureEcrAuth).toHaveBeenCalledBefore(
      rs.mocked(execSync) as never,
    );
  });

  it('should push image using docker push command', async () => {
    const fullImageTag =
      '123456789.dkr.ecr.us-east-1.amazonaws.com/my-project/kong:v1.0.0';
    const registryUrl = '123456789.dkr.ecr.us-east-1.amazonaws.com/my-project';

    await pushAwsKongImage(fullImageTag, registryUrl, mockCredentials);

    expect(execSync).toHaveBeenCalledWith(`docker push ${fullImageTag}`, {
      stdio: 'inherit',
    });
  });

  it('should log progress messages', async () => {
    const registryUrl = '123456789.dkr.ecr.us-east-1.amazonaws.com/my-project';
    const fullImageTag = `${registryUrl}/kong:v1.0.0`;

    await pushAwsKongImage(fullImageTag, registryUrl, mockCredentials);

    expect(mockLogger.generating).toHaveBeenCalledWith(
      expect.stringContaining('Configuring Docker authentication'),
    );
    expect(mockLogger.generating).toHaveBeenCalledWith(
      'Pushing to registry...',
    );
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining(fullImageTag),
    );
  });

  it('should extract registry host from URL', async () => {
    const registryUrl = '123456789.dkr.ecr.us-east-1.amazonaws.com/my-project';

    await pushAwsKongImage(
      `${registryUrl}/kong:v1.0.0`,
      registryUrl,
      mockCredentials,
    );

    expect(mockLogger.generating).toHaveBeenCalledWith(
      expect.stringContaining('123456789.dkr.ecr.us-east-1.amazonaws.com'),
    );
  });
});
