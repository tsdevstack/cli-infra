import { describe, it, expect } from '@rstest/core';
import { parseCpuToNumber } from './parse-cpu-to-number';

describe('parseCpuToNumber', () => {
  describe('string inputs', () => {
    it('should convert "1" vCPU to 1024 units', () => {
      expect(parseCpuToNumber('1')).toBe(1024);
    });

    it('should convert "2" vCPU to 2048 units', () => {
      expect(parseCpuToNumber('2')).toBe(2048);
    });

    it('should convert "0.25" vCPU to 256 units', () => {
      expect(parseCpuToNumber('0.25')).toBe(256);
    });

    it('should convert "0.5" vCPU to 512 units', () => {
      expect(parseCpuToNumber('0.5')).toBe(512);
    });

    it('should convert "4" vCPU to 4096 units', () => {
      expect(parseCpuToNumber('4')).toBe(4096);
    });
  });

  describe('number inputs', () => {
    it('should convert 1 vCPU to 1024 units', () => {
      expect(parseCpuToNumber(1)).toBe(1024);
    });

    it('should convert 0.5 vCPU to 512 units', () => {
      expect(parseCpuToNumber(0.5)).toBe(512);
    });

    it('should convert 2 vCPU to 2048 units', () => {
      expect(parseCpuToNumber(2)).toBe(2048);
    });
  });
});
