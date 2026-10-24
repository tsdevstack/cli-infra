import { describe, it, expect } from '@rstest/core';
import { parseMemoryToNumber } from './parse-memory-to-number';

describe('parseMemoryToNumber', () => {
  describe('Mi suffix (mebibytes)', () => {
    it('should convert "512Mi" to 512 MB', () => {
      expect(parseMemoryToNumber('512Mi')).toBe(512);
    });

    it('should convert "1024Mi" to 1024 MB', () => {
      expect(parseMemoryToNumber('1024Mi')).toBe(1024);
    });

    it('should convert "256Mi" to 256 MB', () => {
      expect(parseMemoryToNumber('256Mi')).toBe(256);
    });
  });

  describe('Gi suffix (gibibytes)', () => {
    it('should convert "1Gi" to 1024 MB', () => {
      expect(parseMemoryToNumber('1Gi')).toBe(1024);
    });

    it('should convert "2Gi" to 2048 MB', () => {
      expect(parseMemoryToNumber('2Gi')).toBe(2048);
    });

    it('should convert "0.5Gi" to 512 MB', () => {
      expect(parseMemoryToNumber('0.5Gi')).toBe(512);
    });
  });

  describe('no suffix (assumes MB)', () => {
    it('should treat "512" as 512 MB', () => {
      expect(parseMemoryToNumber('512')).toBe(512);
    });

    it('should treat "1024" as 1024 MB', () => {
      expect(parseMemoryToNumber('1024')).toBe(1024);
    });
  });

  describe('number inputs', () => {
    it('should pass through number as-is', () => {
      expect(parseMemoryToNumber(512)).toBe(512);
    });

    it('should pass through larger number as-is', () => {
      expect(parseMemoryToNumber(2048)).toBe(2048);
    });
  });
});
