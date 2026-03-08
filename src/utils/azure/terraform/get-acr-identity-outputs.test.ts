import { describe, it, expect, rs, beforeEach } from '@rstest/core';

rs.mock('../../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

import { getAcrIdentityOutputs } from './get-acr-identity-outputs';
import { getTerraformOutput } from '../../terraform';

describe('getAcrIdentityOutputs', () => {
  const terraformDir = '/test/terraform';
  const tfEnv = { ARM_SUBSCRIPTION_ID: 'sub-123' };

  beforeEach(() => {
    rs.restoreAllMocks();
  });

  it('should return both values when Terraform outputs exist', () => {
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, name: string) => {
        const outputs: Record<string, string> = {
          container_apps_acr_identity_id: '/subscriptions/sub/mi-id',
          container_apps_acr_identity_client_id: 'client-id-123',
        };
        return outputs[name] ?? '';
      },
    );

    const result = getAcrIdentityOutputs(terraformDir, tfEnv);

    expect(result.acrManagedIdentityId).toBe('/subscriptions/sub/mi-id');
    expect(result.managedIdentityClientId).toBe('client-id-123');
  });

  it('should return undefined for both when Terraform outputs do not exist', () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('output not found');
    });

    const result = getAcrIdentityOutputs(terraformDir, tfEnv);

    expect(result.acrManagedIdentityId).toBeUndefined();
    expect(result.managedIdentityClientId).toBeUndefined();
  });

  it('should return partial results when only identity ID exists', () => {
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, name: string) => {
        if (name === 'container_apps_acr_identity_id') {
          return '/subscriptions/sub/mi-id';
        }
        throw new Error('output not found');
      },
    );

    const result = getAcrIdentityOutputs(terraformDir, tfEnv);

    expect(result.acrManagedIdentityId).toBe('/subscriptions/sub/mi-id');
    expect(result.managedIdentityClientId).toBeUndefined();
  });

  it('should return partial results when only client ID exists', () => {
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, name: string) => {
        if (name === 'container_apps_acr_identity_client_id') {
          return 'client-id-123';
        }
        throw new Error('output not found');
      },
    );

    const result = getAcrIdentityOutputs(terraformDir, tfEnv);

    expect(result.acrManagedIdentityId).toBeUndefined();
    expect(result.managedIdentityClientId).toBe('client-id-123');
  });
});
