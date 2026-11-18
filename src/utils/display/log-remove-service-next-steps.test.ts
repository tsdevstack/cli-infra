import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockLogger = { info: rs.fn(), warn: rs.fn(), newline: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger }),
}));

import { logRemoveServiceNextSteps } from './log-remove-service-next-steps';

describe('logRemoveServiceNextSteps', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should point to remove-service, then infra:deploy for the environment', () => {
      logRemoveServiceNextSteps('react-app', 'dev');

      const lines = mockLogger.info.mock.calls.map((call) => call[0]);
      expect(lines).toEqual([
        'Next steps:',
        '  1. Remove it from the other environments (if deployed)',
        '  2. npx tsdevstack remove-service react-app  # removes it from the project',
        '  3. npx tsdevstack infra:deploy --env dev  # removes its Kong and load balancer routes',
      ]);
    });

    it('should not send the user to the Kong-only commands (they leave the load balancer routes)', () => {
      logRemoveServiceNextSteps('react-app', 'dev');

      const text = mockLogger.info.mock.calls.map((call) => call[0]).join('\n');
      expect(text).not.toContain('infra:deploy-kong');
      expect(text).not.toContain('infra:build-kong');
    });

    it('should warn until infra:deploy runs', () => {
      logRemoveServiceNextSteps('react-app', 'dev');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Until infra:deploy runs, its Kong routes return 502, scheduled jobs that call it fail, and a domain it had stops working.',
      );
    });
  });
});
