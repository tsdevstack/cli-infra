import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { execSync } from 'node:child_process';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(),
}));

rs.mock('../credentials/fetch-secret', () => ({
  fetchSecret: rs.fn(),
}));

import { fetchSharedSecrets } from './fetch-shared-secrets';
import { fetchSecret } from '../credentials/fetch-secret';

describe('fetchSharedSecrets', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should list secrets and fetch each one', () => {
    rs.mocked(execSync).mockReturnValue(
      JSON.stringify({
        provider: 'gcp',
        project: 'myproject',
        environment: 'dev',
        total: 2,
        shared: ['API_KEY', 'DATABASE_URL'],
        services: {},
      }),
    );
    rs.mocked(fetchSecret).mockReturnValueOnce('api-key-value');
    rs.mocked(fetchSecret).mockReturnValueOnce('postgres://localhost');

    const result = fetchSharedSecrets('dev');

    expect(result).toEqual({
      API_KEY: 'api-key-value',
      DATABASE_URL: 'postgres://localhost',
    });
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('cloud-secrets:list --env dev --json'),
      expect.any(Object),
    );
  });

  it('should return empty object when no shared secrets', () => {
    rs.mocked(execSync).mockReturnValue(
      JSON.stringify({
        shared: [],
        services: {},
      }),
    );

    const result = fetchSharedSecrets('staging');

    expect(result).toEqual({});
    expect(fetchSecret).not.toHaveBeenCalled();
  });

  it('should skip secrets that could not be fetched', () => {
    rs.mocked(execSync).mockReturnValue(
      JSON.stringify({
        shared: ['API_KEY', 'MISSING_SECRET'],
        services: {},
      }),
    );
    rs.mocked(fetchSecret).mockReturnValueOnce('api-key-value');
    rs.mocked(fetchSecret).mockReturnValueOnce(null);

    const result = fetchSharedSecrets('dev');

    expect(result).toEqual({
      API_KEY: 'api-key-value',
    });
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it('should throw error when cloud-secrets:list fails', () => {
    rs.mocked(execSync).mockImplementation(() => {
      throw new Error('Command failed');
    });

    expect(() => fetchSharedSecrets('dev')).toThrow(
      /Failed to list secrets for environment "dev"/,
    );
  });

  it('should handle missing shared array in response', () => {
    rs.mocked(execSync).mockReturnValue(JSON.stringify({ services: {} }));

    const result = fetchSharedSecrets('dev');

    expect(result).toEqual({});
  });

  it('should log progress messages', () => {
    rs.mocked(execSync).mockReturnValue(
      JSON.stringify({
        shared: ['KEY1'],
        services: {},
      }),
    );
    rs.mocked(fetchSecret).mockReturnValue('value');

    fetchSharedSecrets('dev');

    expect(mocks.logger.info).toHaveBeenCalled();
    expect(mocks.logger.success).toHaveBeenCalled();
  });
});
