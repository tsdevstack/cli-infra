import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';
import type { TerraformResult } from '@tsdevstack/infra-core';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { applyWithServiceAgentRetry } from './apply-with-service-agent-retry';

const OK: TerraformResult = { success: true, output: 'Apply complete!' };
const RACE: TerraformResult = {
  success: false,
  output:
    '│ Error: Error waiting for Create Service Networking Connection: Error code 16, message: Request had invalid authentication credentials.',
};
const OTHER_FAILURE: TerraformResult = {
  success: false,
  output:
    '│ Error: googleapi: Error 409: The requested bucket name is not available.',
};

describe('applyWithServiceAgentRetry', () => {
  let wait: ReturnType<typeof rs.fn>;

  beforeEach(() => {
    rs.clearAllMocks();
    wait = rs.fn().mockResolvedValue(undefined);
  });

  describe('Standard use cases', () => {
    it('should return a successful apply without waiting', async () => {
      const apply = rs.fn().mockResolvedValue(OK);

      await expect(applyWithServiceAgentRetry(apply, { wait })).resolves.toBe(
        OK,
      );
      expect(apply).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    });

    it('should wait and apply again after the Service Networking race', async () => {
      const apply = rs
        .fn()
        .mockResolvedValueOnce(RACE)
        .mockResolvedValueOnce(OK);

      await expect(
        applyWithServiceAgentRetry(apply, { wait, delayMs: 60_000 }),
      ).resolves.toBe(OK);
      expect(apply).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledWith(60_000);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not a credentials problem'),
      );
    });
  });

  describe('Edge cases', () => {
    it('should return any other failure at once', async () => {
      const apply = rs.fn().mockResolvedValue(OTHER_FAILURE);

      await expect(applyWithServiceAgentRetry(apply, { wait })).resolves.toBe(
        OTHER_FAILURE,
      );
      expect(apply).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    });

    it('should give up after the retries and return the last result', async () => {
      const apply = rs.fn().mockResolvedValue(RACE);

      await expect(
        applyWithServiceAgentRetry(apply, { wait, retries: 2 }),
      ).resolves.toBe(RACE);
      expect(apply).toHaveBeenCalledTimes(3);
      expect(wait).toHaveBeenCalledTimes(2);
    });

    it('should stop retrying when the next failure is a different one', async () => {
      const apply = rs
        .fn()
        .mockResolvedValueOnce(RACE)
        .mockResolvedValueOnce(OTHER_FAILURE);

      await expect(applyWithServiceAgentRetry(apply, { wait })).resolves.toBe(
        OTHER_FAILURE,
      );
      expect(apply).toHaveBeenCalledTimes(2);
    });
  });
});
