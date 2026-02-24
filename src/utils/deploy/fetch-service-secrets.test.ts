import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('./get-service-secret-keys', () => ({
  getServiceSecretKeys: rs.fn(),
}));

rs.mock('../credentials/fetch-secret', () => ({
  fetchSecret: rs.fn(),
}));

import { fetchServiceSecrets } from './fetch-service-secrets';
import { getServiceSecretKeys } from './get-service-secret-keys';
import { fetchSecret } from '../credentials/fetch-secret';

describe('fetchServiceSecrets', () => {
  const mockConfig = {
    project: { name: 'test-project', version: '1.0.0' },
    cloud: { provider: null },
    services: [],
  };

  beforeEach(() => {
    rs.resetAllMocks();
  });

  it('should fetch only keys referenced by the service', () => {
    rs.mocked(getServiceSecretKeys).mockReturnValue([
      'API_URL',
      'ACCESS_TOKEN_TTL',
    ]);
    rs.mocked(fetchSecret).mockImplementation((key: string) => {
      const values: Record<string, string> = {
        API_URL: 'https://api.example.com',
        ACCESS_TOKEN_TTL: '900',
      };
      return values[key] ?? null;
    });

    const result = fetchServiceSecrets('frontend', mockConfig, 'dev');

    expect(result).toEqual({
      API_URL: 'https://api.example.com',
      ACCESS_TOKEN_TTL: '900',
    });
    expect(fetchSecret).toHaveBeenCalledTimes(2);
    expect(fetchSecret).toHaveBeenCalledWith('API_URL', 'dev');
    expect(fetchSecret).toHaveBeenCalledWith('ACCESS_TOKEN_TTL', 'dev');
  });

  it('should return empty object when service has no keys', () => {
    rs.mocked(getServiceSecretKeys).mockReturnValue([]);

    const result = fetchServiceSecrets('frontend', mockConfig, 'dev');

    expect(result).toEqual({});
    expect(fetchSecret).not.toHaveBeenCalled();
  });

  it('should skip keys that could not be fetched', () => {
    rs.mocked(getServiceSecretKeys).mockReturnValue(['API_URL', 'MISSING_KEY']);
    rs.mocked(fetchSecret).mockImplementation((key: string) => {
      if (key === 'API_URL') return 'https://api.example.com';
      return null;
    });

    const result = fetchServiceSecrets('frontend', mockConfig, 'dev');

    expect(result).toEqual({ API_URL: 'https://api.example.com' });
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Could not fetch secret: MISSING_KEY',
    );
  });

  it('should log the number of keys referenced', () => {
    rs.mocked(getServiceSecretKeys).mockReturnValue(['API_URL']);
    rs.mocked(fetchSecret).mockReturnValue('value');

    fetchServiceSecrets('frontend', mockConfig, 'dev');

    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Service "frontend" references 1 secret key',
    );
  });
});
