import { describe, it, expect } from '@rstest/core';
import { normalizeLogLevel } from './normalize-log-level';

describe('normalizeLogLevel', () => {
  describe('Standard use cases', () => {
    it('should keep pino labels', () => {
      expect(normalizeLogLevel('debug')).toBe('debug');
      expect(normalizeLogLevel('info')).toBe('info');
      expect(normalizeLogLevel('warn')).toBe('warn');
      expect(normalizeLogLevel('error')).toBe('error');
      expect(normalizeLogLevel('fatal')).toBe('fatal');
    });

    it('should map pino numbers', () => {
      expect(normalizeLogLevel(10)).toBe('debug');
      expect(normalizeLogLevel(20)).toBe('debug');
      expect(normalizeLogLevel(30)).toBe('info');
      expect(normalizeLogLevel(40)).toBe('warn');
      expect(normalizeLogLevel(50)).toBe('error');
      expect(normalizeLogLevel(60)).toBe('fatal');
    });

    it('should map GCP severities', () => {
      expect(normalizeLogLevel('DEBUG')).toBe('debug');
      expect(normalizeLogLevel('INFO')).toBe('info');
      expect(normalizeLogLevel('NOTICE')).toBe('info');
      expect(normalizeLogLevel('WARNING')).toBe('warn');
      expect(normalizeLogLevel('ERROR')).toBe('error');
      expect(normalizeLogLevel('CRITICAL')).toBe('fatal');
      expect(normalizeLogLevel('ALERT')).toBe('fatal');
      expect(normalizeLogLevel('EMERGENCY')).toBe('fatal');
    });

    it('should map Azure levels', () => {
      expect(normalizeLogLevel('Normal')).toBe('info');
      expect(normalizeLogLevel('Informational')).toBe('info');
      expect(normalizeLogLevel('Warning')).toBe('warn');
      expect(normalizeLogLevel('Error')).toBe('error');
    });
  });

  describe('Edge cases', () => {
    it('should give no level for GCP DEFAULT, unknown text and other types', () => {
      expect(normalizeLogLevel('DEFAULT')).toBeUndefined();
      expect(normalizeLogLevel('loud')).toBeUndefined();
      expect(normalizeLogLevel('constructor')).toBeUndefined();
      expect(normalizeLogLevel(5)).toBeUndefined();
      expect(normalizeLogLevel(undefined)).toBeUndefined();
      expect(normalizeLogLevel({ level: 'info' })).toBeUndefined();
    });
  });
});
