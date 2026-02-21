import { describe, it, expect } from '@rstest/core';
import { convertCronToEventBridge } from './convert-cron-to-eventbridge';

describe('convertCronToEventBridge', () => {
  describe('standard 5-field cron expressions', () => {
    it('should convert daily at midnight', () => {
      // Unix: minute hour day month weekday
      // 0 0 * * * = at 00:00 every day
      expect(convertCronToEventBridge('0 0 * * *')).toBe('cron(0 0 * * ? *)');
    });

    it('should convert hourly cron', () => {
      // 0 * * * * = at minute 0 every hour
      expect(convertCronToEventBridge('0 * * * *')).toBe('cron(0 * * * ? *)');
    });

    it('should convert every 5 minutes', () => {
      // */5 * * * * = every 5 minutes
      expect(convertCronToEventBridge('*/5 * * * *')).toBe(
        'cron(*/5 * * * ? *)',
      );
    });

    it('should convert specific day of month', () => {
      // 0 0 1 * * = at midnight on the 1st of every month
      expect(convertCronToEventBridge('0 0 1 * *')).toBe('cron(0 0 1 * ? *)');
    });

    it('should convert specific day of week', () => {
      // 0 0 * * 0 = at midnight every Sunday
      expect(convertCronToEventBridge('0 0 * * 0')).toBe('cron(0 0 ? * 0 *)');
    });

    it('should convert weekly on Monday at 9am', () => {
      // 0 9 * * 1 = at 9am every Monday
      expect(convertCronToEventBridge('0 9 * * 1')).toBe('cron(0 9 ? * 1 *)');
    });
  });

  describe('already EventBridge format', () => {
    it('should return cron() expression as-is', () => {
      const expr = 'cron(0 0 * * ? *)';
      expect(convertCronToEventBridge(expr)).toBe(expr);
    });

    it('should return rate() expression as-is', () => {
      const expr = 'rate(5 minutes)';
      expect(convertCronToEventBridge(expr)).toBe(expr);
    });
  });

  describe('edge cases', () => {
    it('should handle extra whitespace', () => {
      expect(convertCronToEventBridge('  0   0   *   *   *  ')).toBe(
        'cron(0 0 * * ? *)',
      );
    });
  });
});
