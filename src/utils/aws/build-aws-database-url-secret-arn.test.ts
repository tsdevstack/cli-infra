import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { buildAwsDatabaseUrlSecretArn } from './build-aws-database-url-secret-arn';

describe('buildAwsDatabaseUrlSecretArn', () => {
  it("should name the service's DATABASE_URL secret by its partial ARN", () => {
    expect(
      buildAwsDatabaseUrlSecretArn(
        {
          region: 'eu-west-1',
          accountId: '123456789012',
          accessKeyId: 'k',
          secretAccessKey: 's',
        },
        'shop',
        'auth-service',
      ),
    ).toBe(
      'arn:aws:secretsmanager:eu-west-1:123456789012:secret:shop-auth-service-DATABASE_URL',
    );
  });
});
