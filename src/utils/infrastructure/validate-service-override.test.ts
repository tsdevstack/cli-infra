import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateServiceOverride } from './validate-service-override';

describe('validateServiceOverride', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('valid configurations', () => {
    it('should accept empty object', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', {}),
      ).not.toThrow();
    });

    it('should accept valid minInstances', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { minInstances: 1 }),
      ).not.toThrow();
    });

    it('should accept valid maxInstances', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { maxInstances: 10 }),
      ).not.toThrow();
    });

    it('should accept valid cpu', () => {
      expect(() =>
        validateServiceOverride('bff-service', 'prod', { cpu: '1' }),
      ).not.toThrow();
    });

    it('should accept valid memory', () => {
      expect(() =>
        validateServiceOverride('bff-service', 'prod', { memory: '512Mi' }),
      ).not.toThrow();
    });

    it('should accept valid timeout', () => {
      expect(() =>
        validateServiceOverride('api-service', 'staging', { timeout: '300s' }),
      ).not.toThrow();
    });

    it('should accept valid port', () => {
      expect(() =>
        validateServiceOverride('api-service', 'dev', { port: 8080 }),
      ).not.toThrow();
    });

    it('should accept valid concurrency', () => {
      expect(() =>
        validateServiceOverride('api-service', 'dev', { concurrency: 80 }),
      ).not.toThrow();
    });

    it('should accept full configuration', () => {
      expect(() =>
        validateServiceOverride('api-service', 'prod', {
          minInstances: 2,
          maxInstances: 10,
          cpu: '2',
          memory: '1Gi',
          timeout: '60s',
          port: 3000,
          concurrency: 100,
        }),
      ).not.toThrow();
    });
  });

  describe('invalid override type', () => {
    it('should throw for null', () => {
      expect(() =>
        validateServiceOverride(
          'auth-service',
          'dev',
          null as unknown as Record<string, unknown>,
        ),
      ).toThrow(mocks.CliError);
    });

    it('should throw for string', () => {
      expect(() =>
        validateServiceOverride(
          'auth-service',
          'dev',
          'invalid' as unknown as Record<string, unknown>,
        ),
      ).toThrow(mocks.CliError);
    });

    it('should throw for array', () => {
      expect(() =>
        validateServiceOverride(
          'auth-service',
          'dev',
          [] as unknown as Record<string, unknown>,
        ),
      ).toThrow(mocks.CliError);
    });
  });

  describe('unknown fields', () => {
    it('should throw for unknown field', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', {
          replicas: 3,
        } as Record<string, unknown>),
      ).toThrow(mocks.CliError);
    });

    it('should include field name in error', () => {
      try {
        validateServiceOverride('auth-service', 'dev', {
          unknownField: true,
        } as Record<string, unknown>);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('unknownField');
      }
    });
  });

  describe('minInstances validation', () => {
    it('should throw for negative minInstances', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { minInstances: -1 }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for non-integer minInstances', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { minInstances: 1.5 }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for string minInstances', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', {
          minInstances: '1',
        } as unknown as Record<string, unknown>),
      ).toThrow(mocks.CliError);
    });
  });

  describe('maxInstances validation', () => {
    it('should throw for maxInstances over limit', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { maxInstances: 1001 }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for non-integer maxInstances', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { maxInstances: 5.5 }),
      ).toThrow(mocks.CliError);
    });
  });

  describe('cpu validation', () => {
    it('should throw for invalid cpu value', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { cpu: '3' }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for numeric cpu', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', {
          cpu: 1,
        } as unknown as Record<string, unknown>),
      ).toThrow(mocks.CliError);
    });
  });

  describe('memory validation', () => {
    it('should throw for invalid memory value', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { memory: '3Gi' }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for numeric memory', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', {
          memory: 512,
        } as unknown as Record<string, unknown>),
      ).toThrow(mocks.CliError);
    });
  });

  describe('timeout validation', () => {
    it('should throw for timeout without s suffix', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { timeout: '300' }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for timeout below minimum', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { timeout: '10s' }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for timeout above maximum', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { timeout: '4000s' }),
      ).toThrow(mocks.CliError);
    });
  });

  describe('port validation', () => {
    it('should throw for port below minimum', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { port: 0 }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for port above maximum', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { port: 70000 }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for non-integer port', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { port: 8080.5 }),
      ).toThrow(mocks.CliError);
    });
  });

  describe('concurrency validation', () => {
    it('should throw for concurrency below minimum', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { concurrency: 0 }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for concurrency above maximum', () => {
      expect(() =>
        validateServiceOverride('auth-service', 'dev', { concurrency: 1001 }),
      ).toThrow(mocks.CliError);
    });
  });

  describe('error context', () => {
    it('should include service name and environment in error', () => {
      try {
        validateServiceOverride('bff-service', 'staging', {
          unknownField: true,
        } as Record<string, unknown>);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('staging.bff-service');
      }
    });
  });
});
