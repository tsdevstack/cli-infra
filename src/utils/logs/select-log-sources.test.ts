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

import { selectLogSources } from './select-log-sources';
import type { LogSource } from './types';

const SOURCES: LogSource[] = [
  { name: 'auth-service', type: 'service' },
  { name: 'kong', type: 'kong' },
  { name: 'edge', type: 'edge' },
];

describe('selectLogSources', () => {
  describe('Standard use cases', () => {
    it('should pick one source by name', () => {
      expect(selectLogSources(SOURCES, 'kong')).toEqual([
        { name: 'kong', type: 'kong' },
      ]);
    });

    it('should pick every source without a name', () => {
      expect(selectLogSources(SOURCES, undefined)).toEqual(SOURCES);
    });
  });

  describe('Edge cases', () => {
    it('should name the known sources when the name is unknown', () => {
      try {
        selectLogSources(SOURCES, 'billing-service');
        expect.unreachable();
      } catch (error) {
        expect((error as MockCliError).message).toBe(
          'Unknown log source: billing-service',
        );
        expect((error as MockCliError).hint).toBe(
          'Sources in this project: auth-service, kong, edge',
        );
      }
    });
  });
});
