import { describe, it, expect } from '@rstest/core';
import { parseImageTag } from './parse-image-tag';

describe('parseImageTag', () => {
  it('should return dash for undefined', () => {
    expect(parseImageTag(undefined)).toBe('-');
  });

  it('should return dash for empty string', () => {
    expect(parseImageTag('')).toBe('-');
  });

  it('should extract tag from ECR URI', () => {
    expect(
      parseImageTag(
        '123456789.dkr.ecr.us-east-1.amazonaws.com/tsdevstack-repo:latest',
      ),
    ).toBe(':latest');
  });

  it('should extract tag from GCR URI', () => {
    expect(
      parseImageTag(
        'us-docker.pkg.dev/my-project/my-repo/auth-service:abc1234',
      ),
    ).toBe(':abc1234');
  });

  it('should extract custom tag', () => {
    expect(
      parseImageTag('123456789.dkr.ecr.us-east-1.amazonaws.com/repo:abc1234'),
    ).toBe(':abc1234');
  });

  it('should extract and truncate sha256 digest', () => {
    const result = parseImageTag(
      '123456789.dkr.ecr.us-east-1.amazonaws.com/repo@sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    );
    expect(result).toBe('sha256:abcdef123456');
    expect(result.length).toBe(19);
  });

  it('should handle short digest without truncation', () => {
    expect(
      parseImageTag(
        '123456789.dkr.ecr.us-east-1.amazonaws.com/repo@sha256:abc',
      ),
    ).toBe('sha256:abc');
  });
});
