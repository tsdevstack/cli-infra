import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { enforceKongMinInstances } from './enforce-kong-min-instances';

describe('enforceKongMinInstances', () => {
  const mockLogger = {
    warn: rs.fn(),
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('when minInstances is 0', () => {
    it('should return 1', () => {
      const result = enforceKongMinInstances(0, mockLogger);
      expect(result).toBe(1);
    });

    it('should log a warning', () => {
      enforceKongMinInstances(0, mockLogger);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Kong minInstances cannot be 0'),
      );
    });
  });

  describe('when minInstances is negative', () => {
    it('should return 1', () => {
      const result = enforceKongMinInstances(-1, mockLogger);
      expect(result).toBe(1);
    });

    it('should log a warning', () => {
      enforceKongMinInstances(-5, mockLogger);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('when minInstances is 1 or greater', () => {
    it('should return the original value for 1', () => {
      const result = enforceKongMinInstances(1, mockLogger);
      expect(result).toBe(1);
    });

    it('should return the original value for 2', () => {
      const result = enforceKongMinInstances(2, mockLogger);
      expect(result).toBe(2);
    });

    it('should return the original value for 10', () => {
      const result = enforceKongMinInstances(10, mockLogger);
      expect(result).toBe(10);
    });

    it('should not log a warning', () => {
      enforceKongMinInstances(1, mockLogger);
      enforceKongMinInstances(5, mockLogger);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
