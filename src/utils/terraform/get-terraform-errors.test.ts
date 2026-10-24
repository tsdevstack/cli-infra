import { describe, it, expect } from '@rstest/core';
import { getTerraformErrors } from './get-terraform-errors';

describe('getTerraformErrors', () => {
  describe('Standard use cases', () => {
    it('should return one entry per boxed error', () => {
      const output = [
        'google_redis_instance.redis: Destruction complete after 3m28s',
        '╷',
        '│ Error: failed to delete user auth-service',
        '│',
        '╵',
        '╷',
        "│ Error: The subnetwork resource 'x' is already being used by 'y'",
        '╵',
      ].join('\n');

      const errors = getTerraformErrors(output);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('failed to delete user auth-service');
      expect(errors[1]).toContain('already being used by');
    });

    it('should read plain errors (-no-color)', () => {
      expect(getTerraformErrors('Plan failed\nError: something')).toEqual([
        'something',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should return nothing for output without errors', () => {
      expect(getTerraformErrors('Apply complete!')).toEqual([]);
      expect(getTerraformErrors('')).toEqual([]);
    });

    it('should not split on "Error:" inside a line', () => {
      expect(getTerraformErrors('log line with Error: inside')).toEqual([]);
    });
  });
});
