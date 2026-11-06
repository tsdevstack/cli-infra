import { describe, it, expect } from '@rstest/core';
import { isServiceCpuAlwaysOn } from './is-service-cpu-always-on';

describe('isServiceCpuAlwaysOn', () => {
  describe('Standard use cases', () => {
    it('should keep CPU on for a NestJS service with min instances 1', () => {
      expect(isServiceCpuAlwaysOn('nestjs', 1)).toBe(true);
    });

    it('should keep CPU on for a NestJS service with min instances 3', () => {
      expect(isServiceCpuAlwaysOn('nestjs', 3)).toBe(true);
    });

    it('should give CPU only during requests to a NestJS service with min instances 0', () => {
      expect(isServiceCpuAlwaysOn('nestjs', 0)).toBe(false);
    });

    it('should give CPU only during requests to Next.js, even with min instances 1', () => {
      expect(isServiceCpuAlwaysOn('nextjs', 1)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should return false for an unknown service type', () => {
      expect(isServiceCpuAlwaysOn(undefined, 1)).toBe(false);
    });
  });
});
