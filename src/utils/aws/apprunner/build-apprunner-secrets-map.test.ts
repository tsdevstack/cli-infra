import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { buildAppRunnerSecretsMap } from './build-apprunner-secrets-map';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

// Mock listSecretsByPrefix
rs.mock('../discovery/list-secrets-by-prefix', () => ({
  listSecretsByPrefix: rs.fn(),
}));

import { listSecretsByPrefix } from '../discovery/list-secrets-by-prefix';

const mockListSecrets = rs.mocked(listSecretsByPrefix);

const mockCredentials: AWSCredentials = {
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  region: 'us-east-1',
  accountId: '123456789012',
};

describe('buildAppRunnerSecretsMap', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should return empty map when no secrets exist', async () => {
    mockListSecrets.mockResolvedValue({
      success: true,
      secrets: [],
    });

    const result = await buildAppRunnerSecretsMap({
      credentials: mockCredentials,
      projectName: 'myproject',
      serviceName: 'frontend',
    });

    expect(result.success).toBe(true);
    expect(result.secrets).toEqual({});
  });

  it('should discover shared secrets', async () => {
    mockListSecrets.mockImplementation(async (options) => {
      if (options.prefix === 'myproject-shared-') {
        return {
          success: true,
          secrets: [
            {
              name: 'myproject-shared-API_KEY',
              arn: 'arn:aws:secretsmanager:us-east-1:123:secret:myproject-shared-API_KEY-abc123',
            },
            {
              name: 'myproject-shared-JWT_SECRET',
              arn: 'arn:aws:secretsmanager:us-east-1:123:secret:myproject-shared-JWT_SECRET-def456',
            },
          ],
        };
      }
      return { success: true, secrets: [] };
    });

    const result = await buildAppRunnerSecretsMap({
      credentials: mockCredentials,
      projectName: 'myproject',
      serviceName: 'frontend',
    });

    expect(result.success).toBe(true);
    expect(result.secrets).toEqual({
      API_KEY:
        'arn:aws:secretsmanager:us-east-1:123:secret:myproject-shared-API_KEY-abc123',
      JWT_SECRET:
        'arn:aws:secretsmanager:us-east-1:123:secret:myproject-shared-JWT_SECRET-def456',
    });
  });

  it('should discover service-scoped secrets', async () => {
    mockListSecrets.mockImplementation(async (options) => {
      if (options.prefix === 'myproject-frontend-') {
        return {
          success: true,
          secrets: [
            {
              name: 'myproject-frontend-DATABASE_URL',
              arn: 'arn:aws:secretsmanager:us-east-1:123:secret:myproject-frontend-DATABASE_URL-xyz789',
            },
          ],
        };
      }
      return { success: true, secrets: [] };
    });

    const result = await buildAppRunnerSecretsMap({
      credentials: mockCredentials,
      projectName: 'myproject',
      serviceName: 'frontend',
    });

    expect(result.success).toBe(true);
    expect(result.secrets).toEqual({
      DATABASE_URL:
        'arn:aws:secretsmanager:us-east-1:123:secret:myproject-frontend-DATABASE_URL-xyz789',
    });
  });

  it('should let service-scoped secrets override shared secrets', async () => {
    mockListSecrets.mockImplementation(async (options) => {
      if (options.prefix === 'myproject-shared-') {
        return {
          success: true,
          secrets: [
            {
              name: 'myproject-shared-API_KEY',
              arn: 'arn:shared-api-key',
            },
          ],
        };
      }
      if (options.prefix === 'myproject-frontend-') {
        return {
          success: true,
          secrets: [
            {
              name: 'myproject-frontend-API_KEY',
              arn: 'arn:frontend-api-key',
            },
          ],
        };
      }
      return { success: true, secrets: [] };
    });

    const result = await buildAppRunnerSecretsMap({
      credentials: mockCredentials,
      projectName: 'myproject',
      serviceName: 'frontend',
    });

    expect(result.success).toBe(true);
    // Service-scoped should override shared
    expect(result.secrets.API_KEY).toBe('arn:frontend-api-key');
  });

  it('should call listSecretsByPrefix with correct prefixes', async () => {
    mockListSecrets.mockResolvedValue({ success: true, secrets: [] });

    await buildAppRunnerSecretsMap({
      credentials: mockCredentials,
      projectName: 'myproject',
      serviceName: 'frontend',
    });

    expect(mockListSecrets).toHaveBeenCalledTimes(2);
    expect(mockListSecrets).toHaveBeenCalledWith({
      credentials: mockCredentials,
      prefix: 'myproject-shared-',
    });
    expect(mockListSecrets).toHaveBeenCalledWith({
      credentials: mockCredentials,
      prefix: 'myproject-frontend-',
    });
  });

  it('should return error when shared secrets list fails', async () => {
    mockListSecrets.mockResolvedValueOnce({
      success: false,
      secrets: [],
      error: 'Access denied',
    });

    const result = await buildAppRunnerSecretsMap({
      credentials: mockCredentials,
      projectName: 'myproject',
      serviceName: 'frontend',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('shared secrets');
  });

  it('should return error when service secrets list fails', async () => {
    mockListSecrets
      .mockResolvedValueOnce({ success: true, secrets: [] })
      .mockResolvedValueOnce({
        success: false,
        secrets: [],
        error: 'Network error',
      });

    const result = await buildAppRunnerSecretsMap({
      credentials: mockCredentials,
      projectName: 'myproject',
      serviceName: 'frontend',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('service secrets');
  });

  it('should skip secrets with invalid key format', async () => {
    mockListSecrets.mockImplementation(async (options) => {
      if (options.prefix === 'myproject-shared-') {
        return {
          success: true,
          secrets: [
            {
              name: 'myproject-shared-VALID_KEY',
              arn: 'arn:valid',
            },
            {
              name: 'myproject-shared-invalid-key',
              arn: 'arn:invalid',
            },
          ],
        };
      }
      return { success: true, secrets: [] };
    });

    const result = await buildAppRunnerSecretsMap({
      credentials: mockCredentials,
      projectName: 'myproject',
      serviceName: 'frontend',
    });

    expect(result.success).toBe(true);
    expect(result.secrets).toEqual({ VALID_KEY: 'arn:valid' });
    expect(result.secrets).not.toHaveProperty('invalid-key');
  });
});
