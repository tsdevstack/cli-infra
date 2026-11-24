import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockLogger = { warn: rs.fn(), newline: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger }),
}));

const mockLoadInfrastructureConfig = rs.fn();
rs.mock('./load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => mockLoadInfrastructureConfig(),
}));

import { remindToRemoveScheduledJobEntry } from './remind-to-remove-scheduled-job-entry';

describe('remindToRemoveScheduledJobEntry', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockLoadInfrastructureConfig.mockReturnValue({
      version: '1.0.0',
      dev: {
        scheduledJobs: [
          {
            name: 'cleanup-tokens',
            schedule: '0 3 * * *',
            targetService: 'auth-service',
            endpoint: '/auth/jobs/cleanup-tokens',
          },
        ],
      },
    });
  });

  describe('Standard use cases', () => {
    it('should name the entry that is still in infrastructure.json', () => {
      remindToRemoveScheduledJobEntry(
        'dev',
        (entry) => entry.name === 'cleanup-tokens',
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '"cleanup-tokens" is still in dev.scheduledJobs in .tsdevstack/infrastructure.json: remove it there too, or the next deploy creates it again',
      );
    });

    it('should say nothing when the entry is already gone', () => {
      remindToRemoveScheduledJobEntry(
        'dev',
        (entry) => entry.name === 'slow-check',
      );

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should say nothing without an infrastructure.json', () => {
      mockLoadInfrastructureConfig.mockReturnValue(null);

      remindToRemoveScheduledJobEntry('dev', () => true);

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("should look only at the target environment's entries", () => {
      remindToRemoveScheduledJobEntry('prod', () => true);

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
