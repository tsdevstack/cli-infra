import { describe, it, expect } from '@rstest/core';
import { FARGATE_DEFAULT } from './normalize-fargate-config';

describe('FARGATE_DEFAULT', () => {
  it('should be smallest valid Fargate configuration', () => {
    expect(FARGATE_DEFAULT.cpu).toBe(256);
    expect(FARGATE_DEFAULT.memory).toBe(512);
  });

  it('should be a valid Fargate combination', () => {
    // 256 CPU supports 512, 1024, 2048 MB
    // 512 MB is valid for 256 CPU
    expect(FARGATE_DEFAULT.cpu).toBe(256);
    expect(FARGATE_DEFAULT.memory).toBeGreaterThanOrEqual(512);
    expect(FARGATE_DEFAULT.memory).toBeLessThanOrEqual(2048);
  });
});
