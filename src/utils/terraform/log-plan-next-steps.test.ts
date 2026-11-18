import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockLogger = { info: rs.fn(), newline: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger }),
}));

import { logPlanNextSteps } from './log-plan-next-steps';

describe('logPlanNextSteps', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should point to infra:deploy when the plan has changes', () => {
      logPlanNextSteps('Plan: 1 to add, 0 to change, 0 to destroy.', 'prod');

      const lines = mockLogger.info.mock.calls.map((call) => call[0]);
      expect(lines).toEqual([
        'To apply these changes, run:',
        '  npx tsdevstack infra:deploy --env prod',
      ]);
    });

    it('should not point to infra:deploy when there is nothing to apply', () => {
      logPlanNextSteps(
        'No changes. Your infrastructure matches the configuration.',
        'prod',
      );

      const lines = mockLogger.info.mock.calls.map((call) => call[0]);
      expect(lines).toEqual([
        'Nothing to deploy: the environment matches the configuration.',
      ]);
    });
  });
});
