import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('@tsdevstack/infra-core', () => ({ invalidateCloudfront: rs.fn() }));
rs.mock('../discovery', () => ({ findServiceDistributions: rs.fn() }));

import { invalidateCloudfront } from '@tsdevstack/infra-core';
import { findServiceDistributions } from '../discovery';
import { clearNextjsCloudfrontCache } from './clear-nextjs-cloudfront-cache';

const credentials = {
  accountId: '123456789012',
  accessKeyId: 'a',
  secretAccessKey: 's',
  region: 'us-east-1',
};
const params = {
  runtime: {} as Parameters<typeof clearNextjsCloudfrontCache>[0]['runtime'],
  projectName: 'shop',
  targetEnv: 'dev',
  serviceName: 'frontend',
  credentials,
};

describe('clearNextjsCloudfrontCache', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  it("should clear the app's own distribution, not an SPA's", async () => {
    rs.mocked(findServiceDistributions).mockResolvedValue({
      success: true,
      distributions: [
        { id: 'ESPA', kind: 'spa' },
        { id: 'ENEXT', kind: 'nextjs' },
      ],
    });
    rs.mocked(invalidateCloudfront).mockResolvedValue({
      invalidationId: 'I1',
    } as Awaited<ReturnType<typeof invalidateCloudfront>>);

    await clearNextjsCloudfrontCache(params);

    expect(findServiceDistributions).toHaveBeenCalledWith({
      projectName: 'shop',
      targetEnv: 'dev',
      serviceName: 'frontend',
      credentials,
    });
    expect(invalidateCloudfront).toHaveBeenCalledTimes(1);
    expect(invalidateCloudfront).toHaveBeenCalledWith(params.runtime, {
      distributionId: 'ENEXT',
      credentials,
    });
    expect(mocks.logger.success).toHaveBeenCalledWith(
      '  ✓ frontend: CloudFront cache cleared (I1)',
    );
  });

  it('should only warn when the distribution cannot be found', async () => {
    rs.mocked(findServiceDistributions).mockResolvedValue({
      success: false,
      distributions: [],
      error: 'AccessDenied',
    });

    await clearNextjsCloudfrontCache(params);

    expect(invalidateCloudfront).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('AccessDenied'),
    );
  });

  it('should only warn when clearing fails', async () => {
    rs.mocked(findServiceDistributions).mockResolvedValue({
      success: true,
      distributions: [{ id: 'ENEXT', kind: 'nextjs' }],
    });
    rs.mocked(invalidateCloudfront).mockRejectedValue(new Error('Throttling'));

    await expect(clearNextjsCloudfrontCache(params)).resolves.toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Throttling'),
    );
  });
});
