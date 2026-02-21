import { describe, it, expect } from '@rstest/core';
import { mergeAppServiceWithDefaults } from './merge-app-service-with-defaults';

describe('mergeAppServiceWithDefaults', () => {
  describe('Standard use cases', () => {
    it('should return defaults when override is undefined', () => {
      const result = mergeAppServiceWithDefaults(undefined);
      expect(result).toEqual({ kongSku: 'B1', nextjsSku: 'B1' });
    });

    it('should override kongSku', () => {
      const result = mergeAppServiceWithDefaults({ kongSku: 'S1' });
      expect(result).toEqual({ kongSku: 'S1', nextjsSku: 'B1' });
    });

    it('should override nextjsSku', () => {
      const result = mergeAppServiceWithDefaults({ nextjsSku: 'S1' });
      expect(result).toEqual({ kongSku: 'B1', nextjsSku: 'S1' });
    });

    it('should override both fields', () => {
      const result = mergeAppServiceWithDefaults({
        kongSku: 'S2',
        nextjsSku: 'P1v3',
      });
      expect(result).toEqual({ kongSku: 'S2', nextjsSku: 'P1v3' });
    });
  });

  describe('Edge cases', () => {
    it('should return defaults for empty override object', () => {
      const result = mergeAppServiceWithDefaults({});
      expect(result).toEqual({ kongSku: 'B1', nextjsSku: 'B1' });
    });
  });
});
