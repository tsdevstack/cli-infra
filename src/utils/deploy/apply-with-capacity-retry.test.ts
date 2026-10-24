import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';
import type { TerraformResult } from '@tsdevstack/infra-core';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { applyWithCapacityRetry } from './apply-with-capacity-retry';

const OK: TerraformResult = { success: true, output: 'Apply complete!' };
const AZURE_CAPACITY: TerraformResult = {
  success: false,
  output:
    '│ Error: creating Flexible Server: polling failed:\n│ Status: "RegionalAllocationFailed"\n│ Message: "We do not have sufficient capacity for the requested compute size in this region."',
  error: 'exit 1',
};
const OTHER_FAILURE: TerraformResult = {
  success: false,
  output: '│ Error: creating Storage Account: StorageAccountAlreadyTaken',
  error: 'exit 1',
};

describe('applyWithCapacityRetry', () => {
  let wait: ReturnType<typeof rs.fn>;

  beforeEach(() => {
    rs.clearAllMocks();
    wait = rs.fn().mockResolvedValue(undefined);
  });

  describe('Standard use cases', () => {
    it('should return a successful apply without waiting', async () => {
      const apply = rs.fn().mockResolvedValue(OK);

      await expect(
        applyWithCapacityRetry(apply, 'azure', { wait }),
      ).resolves.toBe(OK);
      expect(apply).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    });

    it('should wait and apply again after a capacity failure', async () => {
      const apply = rs
        .fn()
        .mockResolvedValueOnce(AZURE_CAPACITY)
        .mockResolvedValueOnce(OK);

      await expect(
        applyWithCapacityRetry(apply, 'azure', { wait, delayMs: 300_000 }),
      ).resolves.toBe(OK);
      expect(apply).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledWith(300_000);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no capacity'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Applying again in 5 minutes (retry 1 of 3)...',
      );
    });

    it('should return any other failure at once', async () => {
      const apply = rs.fn().mockResolvedValue(OTHER_FAILURE);

      await expect(
        applyWithCapacityRetry(apply, 'azure', { wait }),
      ).resolves.toBe(OTHER_FAILURE);
      expect(apply).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should give up with a capacity error after the last retry', async () => {
      const apply = rs.fn().mockResolvedValue(AZURE_CAPACITY);

      await expect(
        applyWithCapacityRetry(apply, 'azure', { wait, retries: 2 }),
      ).rejects.toThrow(mocks.CliError);
      expect(apply).toHaveBeenCalledTimes(3);
      expect(wait).toHaveBeenCalledTimes(2);
    });

    it('should return the failure when a retry fails for another reason', async () => {
      const apply = rs
        .fn()
        .mockResolvedValueOnce(AZURE_CAPACITY)
        .mockResolvedValueOnce(OTHER_FAILURE);

      await expect(
        applyWithCapacityRetry(apply, 'azure', { wait }),
      ).resolves.toBe(OTHER_FAILURE);
      expect(apply).toHaveBeenCalledTimes(2);
    });

    it("should not retry another provider's capacity code", async () => {
      const apply = rs.fn().mockResolvedValue(AZURE_CAPACITY);

      await expect(
        applyWithCapacityRetry(apply, 'aws', { wait }),
      ).resolves.toBe(AZURE_CAPACITY);
      expect(wait).not.toHaveBeenCalled();
    });
  });
});
