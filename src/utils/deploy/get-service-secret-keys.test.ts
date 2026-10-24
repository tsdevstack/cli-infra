import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { getServiceSecretKeys } from './get-service-secret-keys';

describe('getServiceSecretKeys', () => {
  const mockConfig = {
    project: { name: 'test-project', version: '1.0.0' },
    cloud: { provider: null },
    services: [
      { name: 'frontend', type: 'nextjs', port: 3000 },
      { name: 'auth-service', type: 'nestjs', port: 3001 },
    ],
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.findProjectRoot.mockReturnValue('/mock/project');
  });

  describe('when secret-map.json exists', () => {
    it('should return keys from secret map for the service', () => {
      mocks.readJsonFile.mockReturnValue({
        frontend: ['KONG_INTERNAL_URL', 'API_URL', 'ACCESS_TOKEN_TTL'],
        'auth-service': ['NODE_ENV', 'REDIS_HOST', 'DATABASE_URL'],
      });

      const result = getServiceSecretKeys('frontend', mockConfig);

      expect(result).toEqual([
        'KONG_INTERNAL_URL',
        'API_URL',
        'ACCESS_TOKEN_TTL',
      ]);
    });

    it('should add framework secrets a newer CLI defines that the map predates', () => {
      mocks.readJsonFile.mockReturnValue({
        frontend: ['KONG_INTERNAL_URL', 'API_URL'],
      });
      mocks.generateFrameworkSecretsFile.mockReturnValue({
        secrets: {},
        frontend: {
          PORT: '3000',
          secrets: ['KONG_INTERNAL_URL', 'KONG_FRONTEND_TOKEN'],
        },
      });

      const result = getServiceSecretKeys('frontend', mockConfig);

      expect(mocks.generateFrameworkSecretsFile).toHaveBeenCalledWith(
        mockConfig,
        null,
      );
      expect(result).toEqual([
        'KONG_INTERNAL_URL',
        'API_URL',
        'KONG_FRONTEND_TOKEN',
      ]);
    });

    it('should return empty array when service not in secret map', () => {
      mocks.readJsonFile.mockReturnValue({
        'auth-service': ['NODE_ENV'],
      });

      const result = getServiceSecretKeys('unknown-service', mockConfig);

      expect(result).toEqual([]);
    });
  });

  describe('when secret-map.json does not exist', () => {
    it('should fall back to generating from framework + user secrets', () => {
      mocks.readJsonFile.mockReturnValue(null);
      mocks.generateFrameworkSecretsFile.mockReturnValue({
        secrets: {},
        frontend: { secrets: ['KONG_INTERNAL_URL'] },
      });
      mocks.loadUserSecrets.mockReturnValue({
        secrets: {},
        frontend: { secrets: ['API_URL'] },
      });

      const result = getServiceSecretKeys('frontend', mockConfig);

      expect(result).toEqual(['KONG_INTERNAL_URL', 'API_URL']);
    });

    it('should handle missing user secrets file', () => {
      mocks.readJsonFile.mockReturnValue(null);
      mocks.generateFrameworkSecretsFile.mockReturnValue({
        secrets: {},
        frontend: { secrets: ['KONG_INTERNAL_URL'] },
      });
      mocks.loadUserSecrets.mockReturnValue(null);

      const result = getServiceSecretKeys('frontend', mockConfig);

      expect(result).toEqual(['KONG_INTERNAL_URL']);
    });

    it('should deduplicate keys from both sources', () => {
      mocks.readJsonFile.mockReturnValue(null);
      mocks.generateFrameworkSecretsFile.mockReturnValue({
        secrets: {},
        frontend: { secrets: ['KONG_INTERNAL_URL', 'API_URL'] },
      });
      mocks.loadUserSecrets.mockReturnValue({
        secrets: {},
        frontend: { secrets: ['API_URL', 'ACCESS_TOKEN_TTL'] },
      });

      const result = getServiceSecretKeys('frontend', mockConfig);

      expect(result).toEqual([
        'KONG_INTERNAL_URL',
        'API_URL',
        'ACCESS_TOKEN_TTL',
      ]);
    });
  });
});
