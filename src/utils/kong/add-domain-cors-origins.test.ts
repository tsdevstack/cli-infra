import { describe, it, expect } from '@rstest/core';
import type { KongTemplate } from '@tsdevstack/cli/plugin';
import { addDomainCorsOrigins } from './add-domain-cors-origins';

function configWithOrigins(origins?: string[] | string): KongTemplate {
  return {
    _format_version: '3.0',
    plugins: [
      { name: 'request-id', config: {} },
      { name: 'cors', config: { origins, credentials: true } },
    ],
  } as unknown as KongTemplate;
}

function originsOf(config: KongTemplate): unknown {
  return config.plugins?.find((p) => p.name === 'cors')?.config.origins;
}

describe('addDomainCorsOrigins', () => {
  describe('Standard use cases', () => {
    it('should add a domain the secret is missing (a SPA domain set after the first push)', () => {
      const config = configWithOrigins(['https://example.com']);

      const added = addDomainCorsOrigins(config, [
        'example.com',
        'app.example.com',
      ]);

      expect(added).toEqual(['https://app.example.com']);
      expect(originsOf(config)).toEqual([
        'https://example.com',
        'https://app.example.com',
      ]);
    });

    it('should keep origins the user added by hand', () => {
      const config = configWithOrigins([
        'https://example.com',
        'https://partner.example.org',
      ]);

      addDomainCorsOrigins(config, ['example.com', 'app.example.com']);

      expect(originsOf(config)).toEqual([
        'https://example.com',
        'https://partner.example.org',
        'https://app.example.com',
      ]);
    });

    it('should add nothing when every domain is there', () => {
      const config = configWithOrigins([
        'https://example.com',
        'https://app.example.com',
      ]);

      expect(
        addDomainCorsOrigins(config, ['example.com', 'app.example.com']),
      ).toEqual([]);
      expect(originsOf(config)).toEqual([
        'https://example.com',
        'https://app.example.com',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should leave `*` alone', () => {
      const config = configWithOrigins(['*']);

      expect(addDomainCorsOrigins(config, ['example.com'])).toEqual([]);
      expect(originsOf(config)).toEqual(['*']);
    });

    it('should add each domain once', () => {
      const config = configWithOrigins([]);

      addDomainCorsOrigins(config, ['example.com', 'example.com']);

      expect(originsOf(config)).toEqual(['https://example.com']);
    });

    it('should take a single origin given as a string', () => {
      const config = configWithOrigins('https://example.com');

      addDomainCorsOrigins(config, ['app.example.com']);

      expect(originsOf(config)).toEqual([
        'https://example.com',
        'https://app.example.com',
      ]);
    });

    it('should start from an empty list when no origin is set', () => {
      const config = configWithOrigins(undefined);

      addDomainCorsOrigins(config, ['example.com']);

      expect(originsOf(config)).toEqual(['https://example.com']);
    });

    it('should do nothing without a CORS plugin', () => {
      const config = {
        _format_version: '3.0',
        plugins: [{ name: 'request-id', config: {} }],
      } as unknown as KongTemplate;

      expect(addDomainCorsOrigins(config, ['example.com'])).toEqual([]);
    });

    it('should change nothing without domains', () => {
      const config = configWithOrigins(['https://example.com']);

      expect(addDomainCorsOrigins(config, [])).toEqual([]);
      expect(originsOf(config)).toEqual(['https://example.com']);
    });
  });
});
