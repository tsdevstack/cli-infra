import { describe, it, expect } from '@rstest/core';
import { getAppServiceConfig } from './get-app-service-config';

describe('getAppServiceConfig', () => {
  describe('Standard use cases', () => {
    it('should return defaults when config is null', () => {
      const result = getAppServiceConfig(null, 'dev');
      expect(result).toEqual({ kongSku: 'B1', nextjsSku: 'B1' });
    });

    it('should return defaults when environment not found', () => {
      const result = getAppServiceConfig({ prod: {} }, 'dev');
      expect(result).toEqual({ kongSku: 'B1', nextjsSku: 'B1' });
    });

    it('should return defaults when appService not set', () => {
      const result = getAppServiceConfig({ dev: { database: {} } }, 'dev');
      expect(result).toEqual({ kongSku: 'B1', nextjsSku: 'B1' });
    });

    it('should merge partial appService override', () => {
      const result = getAppServiceConfig(
        { dev: { appService: { kongSku: 'S1' } } },
        'dev',
      );
      expect(result).toEqual({ kongSku: 'S1', nextjsSku: 'B1' });
    });

    it('should merge full appService override', () => {
      const result = getAppServiceConfig(
        { dev: { appService: { kongSku: 'S2', nextjsSku: 'P1v3' } } },
        'dev',
      );
      expect(result).toEqual({ kongSku: 'S2', nextjsSku: 'P1v3' });
    });
  });

  describe('Edge cases', () => {
    it('should handle non-object environment value', () => {
      const result = getAppServiceConfig({ dev: 'invalid' as unknown }, 'dev');
      expect(result).toEqual({ kongSku: 'B1', nextjsSku: 'B1' });
    });
  });
});
