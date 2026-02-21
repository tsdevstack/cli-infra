import { describe, it, expect } from '@rstest/core';
import { extractPlaceholders } from './extract-placeholders';

describe('extractPlaceholders', () => {
  describe('string values', () => {
    it('should extract single placeholder from string', () => {
      const result = extractPlaceholders('${DATABASE_URL}');
      expect(result).toEqual(['DATABASE_URL']);
    });

    it('should extract multiple placeholders from string', () => {
      const result = extractPlaceholders('${HOST}:${PORT}');
      expect(result).toContain('HOST');
      expect(result).toContain('PORT');
      expect(result).toHaveLength(2);
    });

    it('should return empty array for string without placeholders', () => {
      const result = extractPlaceholders('no placeholders here');
      expect(result).toEqual([]);
    });

    it('should handle empty string', () => {
      const result = extractPlaceholders('');
      expect(result).toEqual([]);
    });
  });

  describe('object values', () => {
    it('should extract placeholders from simple object', () => {
      const obj = {
        url: '${DATABASE_URL}',
        key: '${API_KEY}',
      };
      const result = extractPlaceholders(obj);
      expect(result).toContain('DATABASE_URL');
      expect(result).toContain('API_KEY');
      expect(result).toHaveLength(2);
    });

    it('should extract placeholders from nested object', () => {
      const obj = {
        database: {
          url: '${DB_URL}',
          settings: {
            password: '${DB_PASSWORD}',
          },
        },
      };
      const result = extractPlaceholders(obj);
      expect(result).toContain('DB_URL');
      expect(result).toContain('DB_PASSWORD');
      expect(result).toHaveLength(2);
    });

    it('should handle empty object', () => {
      const result = extractPlaceholders({});
      expect(result).toEqual([]);
    });
  });

  describe('array values', () => {
    it('should extract placeholders from array of strings', () => {
      const arr = ['${VAR1}', '${VAR2}', 'no placeholder'];
      const result = extractPlaceholders(arr);
      expect(result).toContain('VAR1');
      expect(result).toContain('VAR2');
      expect(result).toHaveLength(2);
    });

    it('should extract placeholders from array of objects', () => {
      const arr = [{ key: '${KEY1}' }, { key: '${KEY2}' }];
      const result = extractPlaceholders(arr);
      expect(result).toContain('KEY1');
      expect(result).toContain('KEY2');
    });

    it('should handle empty array', () => {
      const result = extractPlaceholders([]);
      expect(result).toEqual([]);
    });
  });

  describe('deduplication', () => {
    it('should return unique placeholders only', () => {
      const obj = {
        field1: '${SHARED_VAR}',
        field2: '${SHARED_VAR}',
        field3: '${UNIQUE_VAR}',
      };
      const result = extractPlaceholders(obj);
      expect(result).toContain('SHARED_VAR');
      expect(result).toContain('UNIQUE_VAR');
      expect(result).toHaveLength(2);
    });
  });

  describe('non-string primitives', () => {
    it('should handle null', () => {
      const result = extractPlaceholders(null);
      expect(result).toEqual([]);
    });

    it('should handle undefined', () => {
      const result = extractPlaceholders(undefined);
      expect(result).toEqual([]);
    });

    it('should handle numbers', () => {
      const result = extractPlaceholders(42);
      expect(result).toEqual([]);
    });

    it('should handle boolean', () => {
      const result = extractPlaceholders(true);
      expect(result).toEqual([]);
    });
  });

  describe('mixed content', () => {
    it('should extract from complex Kong config structure', () => {
      const kongConfig = {
        _format_version: '3.0',
        services: [
          {
            name: 'auth-service',
            url: 'http://${AUTH_HOST}:${AUTH_PORT}',
            plugins: [
              {
                name: 'oidc',
                config: {
                  client_id: '${OIDC_CLIENT_ID}',
                  client_secret: '${OIDC_CLIENT_SECRET}',
                },
              },
            ],
          },
        ],
      };
      const result = extractPlaceholders(kongConfig);
      expect(result).toContain('AUTH_HOST');
      expect(result).toContain('AUTH_PORT');
      expect(result).toContain('OIDC_CLIENT_ID');
      expect(result).toContain('OIDC_CLIENT_SECRET');
      expect(result).toHaveLength(4);
    });
  });

  describe('Kong runtime env var syntax', () => {
    it('should NOT extract Kong double-brace env var syntax', () => {
      const result = extractPlaceholders('${{env "WAKEUP_LAMBDA_DOMAIN"}}');
      expect(result).toEqual([]);
    });

    it('should extract single-brace but not double-brace placeholders', () => {
      const config = {
        url: '${AUTH_SERVICE_URL}',
        target: '${{env "WAKEUP_LAMBDA_DOMAIN"}}',
      };
      const result = extractPlaceholders(config);
      expect(result).toContain('AUTH_SERVICE_URL');
      expect(result).not.toContain('{env "WAKEUP_LAMBDA_DOMAIN"}}');
      expect(result).toHaveLength(1);
    });
  });
});
