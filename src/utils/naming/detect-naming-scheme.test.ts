import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { detectNamingScheme } from './detect-naming-scheme';

const resource = { mode: 'managed', type: 'google_compute_network' };

describe('detectNamingScheme', () => {
  describe('Standard use cases', () => {
    it('should give unique names to an environment without state', () => {
      expect(detectNamingScheme(undefined, 'infra:deploy')).toBe('unique');
    });

    it('should keep the names of an environment deployed before the scheme existed', () => {
      expect(
        detectNamingScheme(
          { version: 4, outputs: {}, resources: [resource] },
          'infra:deploy',
        ),
      ).toBe('legacy');
    });

    it('should use the scheme the state records', () => {
      expect(
        detectNamingScheme(
          {
            outputs: { naming_scheme: { value: 'unique', type: 'string' } },
            resources: [resource],
          },
          'infra:deploy',
        ),
      ).toBe('unique');
      expect(
        detectNamingScheme(
          {
            outputs: { naming_scheme: { value: 'legacy', type: 'string' } },
            resources: [resource],
          },
          'infra:deploy',
        ),
      ).toBe('legacy');
    });
  });

  describe('Edge cases', () => {
    it('should give unique names when the state holds no resources (destroyed)', () => {
      expect(
        detectNamingScheme(
          { version: 4, outputs: {}, resources: [] },
          'infra:deploy',
        ),
      ).toBe('unique');
    });

    it('should stop on a state that is not an object', () => {
      expect(() => detectNamingScheme('nope', 'infra:deploy')).toThrow(
        'The Terraform state is not a JSON object',
      );
      expect(() => detectNamingScheme(null, 'infra:deploy')).toThrow();
    });

    it('should stop on a scheme it does not know', () => {
      expect(() =>
        detectNamingScheme(
          { outputs: { naming_scheme: { value: 'v3' } }, resources: [] },
          'infra:deploy',
        ),
      ).toThrow('unknown naming scheme: "v3"');
    });
  });
});
