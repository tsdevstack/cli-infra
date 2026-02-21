import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { getAwsKongRegistryInfo } from './get-kong-registry-info';

rs.mock('../../../context', () => ({
  getContext: rs.fn(),
}));

rs.mock('../../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

import { getContext } from '../../../context';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';

describe('getAwsKongRegistryInfo', () => {
  const mockCliError = class extends Error {
    constructor(
      message: string,
      public context: string,
      public hint: string,
    ) {
      super(message);
    }
  };

  const mockCredentials = {
    accountId: '123456789012',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    region: 'us-east-1',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    rs.mocked(getContext).mockReturnValue({
      CliError: mockCliError,
    } as ReturnType<typeof getContext>);
    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
  });

  it('should return registry URL and host from terraform output', () => {
    const registryUrl = '123456789.dkr.ecr.us-east-1.amazonaws.com/my-project';
    rs.mocked(getTerraformOutput).mockReturnValue(registryUrl);

    const result = getAwsKongRegistryInfo(
      '/project/root',
      'dev',
      mockCredentials,
    );

    expect(result).toEqual({
      registryUrl,
      registryHost: '123456789.dkr.ecr.us-east-1.amazonaws.com',
    });
  });

  it('should call getTerraformOutput with correct parameters', () => {
    rs.mocked(getTerraformOutput).mockReturnValue(
      '123456789.dkr.ecr.us-east-1.amazonaws.com/my-project',
    );

    getAwsKongRegistryInfo('/project/root', 'dev', mockCredentials);

    expect(getTerraformOutput).toHaveBeenCalledWith(
      '/project/root/infrastructure/terraform/dev',
      'ecr_repository_url',
      { AWS_REGION: 'us-east-1' },
    );
  });

  it('should throw CliError when terraform output fails', () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('Terraform error');
    });

    expect(() =>
      getAwsKongRegistryInfo('/project/root', 'dev', mockCredentials),
    ).toThrow(mockCliError);
  });

  it('should include environment in error hint', () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('Terraform error');
    });

    try {
      getAwsKongRegistryInfo('/project/root', 'staging', mockCredentials);
    } catch (error) {
      expect((error as InstanceType<typeof mockCliError>).hint).toContain(
        'staging',
      );
    }
  });
});
