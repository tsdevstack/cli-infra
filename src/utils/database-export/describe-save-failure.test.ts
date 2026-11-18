import { describe, it, expect, rs } from '@rstest/core';

rs.mock('../../constants', () => ({ DB_EXPORT_FAILURE_LINES: 3 }));

import { describeSaveFailure } from './describe-save-failure';

describe('describeSaveFailure', () => {
  describe('Standard use cases', () => {
    it("should give the message, then the end of the job's output", () => {
      const error = Object.assign(new Error('db-init (export) failed'), {
        hint: 'line 1\n\nline 2\n  line 3  \nline 4\n',
      });

      expect(describeSaveFailure(error)).toEqual([
        'db-init (export) failed',
        'line 2',
        'line 3',
        'line 4',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should give the message alone without output', () => {
      expect(describeSaveFailure(new Error('Network down'))).toEqual([
        'Network down',
      ]);
    });

    it('should read anything thrown', () => {
      expect(describeSaveFailure('plain text')).toEqual(['plain text']);
    });
  });
});
