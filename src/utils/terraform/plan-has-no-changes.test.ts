import { describe, it, expect } from '@rstest/core';
import { planHasNoChanges } from './plan-has-no-changes';

describe('planHasNoChanges', () => {
  describe('Standard use cases', () => {
    it('should see a plan with nothing to apply', () => {
      const output = [
        'google_storage_bucket.spa: Refreshing state...',
        '',
        'No changes. Your infrastructure matches the configuration.',
        '',
        'Terraform has compared your real infrastructure against your configuration',
        'and found no differences, so no changes are needed.',
      ].join('\n');

      expect(planHasNoChanges(output)).toBe(true);
    });

    it('should see a plan with changes', () => {
      const output = [
        'Terraform will perform the following actions:',
        '',
        'Plan: 2 to add, 1 to change, 0 to destroy.',
      ].join('\n');

      expect(planHasNoChanges(output)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should read colored output', () => {
      const output =
        '\u001b[0m\u001b[1m\u001b[32mNo changes.\u001b[0m\u001b[1m Your infrastructure matches the configuration.\u001b[0m';

      expect(planHasNoChanges(output)).toBe(true);
    });

    it('should not match "No changes" inside a resource line', () => {
      const output =
        '  ~ description = "No changes. old" -> "new"\nPlan: 0 to add, 1 to change, 0 to destroy.';

      expect(planHasNoChanges(output)).toBe(false);
    });

    it('should treat empty output as having changes', () => {
      expect(planHasNoChanges('')).toBe(false);
    });
  });
});
