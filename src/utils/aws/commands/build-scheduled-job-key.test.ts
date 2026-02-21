import { describe, it, expect } from '@rstest/core';
import { buildScheduledJobKey } from './build-scheduled-job-key';

describe('buildScheduledJobKey', () => {
  it('should build key from target service and job name', () => {
    expect(buildScheduledJobKey('auth-service', 'cleanup-tokens')).toBe(
      'auth-service-cleanup-tokens',
    );
  });

  it('should handle different service and job names', () => {
    expect(buildScheduledJobKey('offers-service', 'sync-prices')).toBe(
      'offers-service-sync-prices',
    );
  });

  it('should handle single-word names', () => {
    expect(buildScheduledJobKey('auth', 'cleanup')).toBe('auth-cleanup');
  });
});
