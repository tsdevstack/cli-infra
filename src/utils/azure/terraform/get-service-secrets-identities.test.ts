import { describe, it, expect, rs, beforeEach } from '@rstest/core';

rs.mock('../../../context', () => ({
  getContext: () =>
    (globalThis as unknown as { contextMocks: unknown }).contextMocks,
}));

const { mockGetTerraformOutputJson } = rs.hoisted(() => ({
  mockGetTerraformOutputJson: rs.fn(),
}));
rs.mock('../../terraform', () => ({
  getTerraformOutputJson: mockGetTerraformOutputJson,
}));

import { getServiceSecretsIdentities } from './get-service-secrets-identities';

describe('getServiceSecretsIdentities', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  it('should read the service_secrets_identities output', () => {
    const identities = {
      'auth-service': { id: '/identities/auth', client_id: 'auth-client' },
    };
    mockGetTerraformOutputJson.mockReturnValue(identities);

    expect(getServiceSecretsIdentities('/tf', { A: 'b' })).toEqual(identities);
    expect(mockGetTerraformOutputJson).toHaveBeenCalledWith(
      '/tf',
      'service_secrets_identities',
      { A: 'b' },
    );
  });

  it('should fail with a hint when the output does not exist', () => {
    mockGetTerraformOutputJson.mockImplementation(() => {
      throw new Error('Output not found');
    });

    expect(() => getServiceSecretsIdentities('/tf', {})).toThrow(
      "The services' Key Vault identities are missing from the Terraform outputs",
    );
  });
});
