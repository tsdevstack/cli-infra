import { describe, it, expect, rs } from '@rstest/core';

class MockCliError extends Error {
  constructor(
    message: string,
    public context?: string,
    public hint?: string,
  ) {
    super(message);
  }
}
rs.mock('../../context', () => ({
  getContext: () => ({ CliError: MockCliError }),
}));

import { parseLogOption } from './parse-log-option';
import { LOG_LEVELS, LOG_KINDS } from '../../constants';

describe('parseLogOption', () => {
  describe('Standard use cases', () => {
    it('should accept an allowed value', () => {
      expect(parseLogOption('--level', 'warn', LOG_LEVELS)).toBe('warn');
      expect(parseLogOption('--kind', 'edge', LOG_KINDS)).toBe('edge');
    });

    it('should ignore case and spaces', () => {
      expect(parseLogOption('--level', ' ERROR ', LOG_LEVELS)).toBe('error');
    });
  });

  describe('Edge cases', () => {
    it('should reject a value that is not allowed and list the allowed ones', () => {
      try {
        parseLogOption('--level', 'verbose', LOG_LEVELS);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(MockCliError);
        expect((error as MockCliError).message).toBe(
          'Invalid --level: verbose',
        );
        expect((error as MockCliError).hint).toBe(
          'Use one of: debug, info, warn, error, fatal',
        );
      }
    });
  });
});
