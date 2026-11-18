import { describe, it, expect } from '@rstest/core';
import { formatGcpTailSuppression } from './format-gcp-tail-suppression';

describe('formatGcpTailSuppression', () => {
  describe('Standard use cases', () => {
    it('should say how many lines were left out and why', () => {
      expect(
        formatGcpTailSuppression([
          { reason: 'RATE_LIMIT', suppressedCount: 1200 },
          { reason: 'NOT_CONSUMED', suppressedCount: 1 },
        ]),
      ).toEqual([
        "Cloud Logging left out at least 1200 lines (over Google's live limit of 60,000 lines a minute).",
        'Cloud Logging left out at least 1 line (they came faster than they could be printed).',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should say nothing when no line was left out', () => {
      expect(formatGcpTailSuppression([])).toEqual([]);
      expect(formatGcpTailSuppression(undefined)).toEqual([]);
      expect(
        formatGcpTailSuppression([
          { reason: 'RATE_LIMIT', suppressedCount: 0 },
        ]),
      ).toEqual([]);
    });

    it('should take a single item and an unknown reason', () => {
      expect(formatGcpTailSuppression({ suppressedCount: 3 })).toEqual([
        'Cloud Logging left out at least 3 lines (no reason given).',
      ]);
    });
  });
});
