import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockLogger = { info: rs.fn(), newline: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger }),
}));

import path from 'node:path';
import { logProviderUpgradeNextSteps } from './log-provider-upgrade-next-steps';

describe('logProviderUpgradeNextSteps', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should name the lock file to commit and the deploy command', () => {
      const outputDir = path.join(
        process.cwd(),
        'infrastructure/terraform/dev',
      );
      logProviderUpgradeNextSteps(outputDir, 'dev');

      const lines = mockLogger.info.mock.calls.map((call) => call[0]);
      expect(lines).toContain(
        '  1. Commit infrastructure/terraform/dev/.terraform.lock.hcl',
      );
      expect(lines).toContain('  2. npx tsdevstack infra:deploy --env dev');
      expect(lines[0]).toContain('Nothing is applied yet');
    });
  });
});
