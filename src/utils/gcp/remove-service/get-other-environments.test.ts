import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { getOtherEnvironments } from './get-other-environments';
import type { GCPCommandContext } from '../commands/types';

const mockGetAvailableEnvironments = rs.fn();
const mockFindProjectRoot = rs.fn();

rs.mock('../../../context', () => ({
  getContext: () => ({
    getAvailableEnvironments: mockGetAvailableEnvironments,
    findProjectRoot: mockFindProjectRoot,
  }),
}));

describe('getOtherEnvironments', () => {
  const createMockContext = (targetEnv: string): GCPCommandContext => ({
    projectName: 'test-project',
    projectRoot: '/path/to/project',
    targetEnv,
    runningInCI: false,
    credentials: {
      project_id: 'test-project-123',
      region: 'us-central1',
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: 'test-key',
    },
  });

  beforeEach(() => {
    rs.clearAllMocks();
    mockFindProjectRoot.mockReturnValue('/path/to/project');
  });

  it('should return other environments excluding current', () => {
    mockGetAvailableEnvironments.mockReturnValue(['dev', 'staging', 'prod']);

    const result = getOtherEnvironments(createMockContext('dev'));

    expect(result).toEqual(['staging', 'prod']);
  });

  it('should return empty array when only one environment exists', () => {
    mockGetAvailableEnvironments.mockReturnValue(['dev']);

    const result = getOtherEnvironments(createMockContext('dev'));

    expect(result).toEqual([]);
  });

  it('should return empty array when getAvailableEnvironments throws', () => {
    mockGetAvailableEnvironments.mockImplementation(() => {
      throw new Error('No credentials found');
    });

    const result = getOtherEnvironments(createMockContext('dev'));

    expect(result).toEqual([]);
  });

  it('should call getAvailableEnvironments with gcp provider', () => {
    mockGetAvailableEnvironments.mockReturnValue(['dev']);

    getOtherEnvironments(createMockContext('dev'));

    expect(mockGetAvailableEnvironments).toHaveBeenCalledWith(
      '/path/to/project',
      'gcp',
    );
  });

  it('should use project root from findProjectRoot', () => {
    mockFindProjectRoot.mockReturnValue('/custom/project/path');
    mockGetAvailableEnvironments.mockReturnValue(['dev']);

    getOtherEnvironments(createMockContext('dev'));

    expect(mockGetAvailableEnvironments).toHaveBeenCalledWith(
      '/custom/project/path',
      'gcp',
    );
  });
});
