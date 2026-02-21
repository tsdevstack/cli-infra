import { describe, it, expect } from '@rstest/core';
import { isNotFoundError } from './is-not-found-error';

describe('isNotFoundError', () => {
  describe('returns true for not found errors', () => {
    it('should return true for NotFound error', () => {
      const error = { name: 'NotFound', message: 'Resource not found' };
      expect(isNotFoundError(error)).toBe(true);
    });

    it('should return true for ResourceNotFoundException', () => {
      const error = {
        name: 'ResourceNotFoundException',
        message: 'Resource not found',
      };
      expect(isNotFoundError(error)).toBe(true);
    });

    it('should return true for NoSuchBucket error', () => {
      const error = { name: 'NoSuchBucket', message: 'Bucket not found' };
      expect(isNotFoundError(error)).toBe(true);
    });
  });

  describe('returns false for other errors', () => {
    it('should return false for generic Error', () => {
      const error = new Error('Something failed');
      expect(isNotFoundError(error)).toBe(false);
    });

    it('should return false for AccessDenied error', () => {
      const error = { name: 'AccessDenied', message: 'Access denied' };
      expect(isNotFoundError(error)).toBe(false);
    });

    it('should return false for ValidationException', () => {
      const error = {
        name: 'ValidationException',
        message: 'Validation failed',
      };
      expect(isNotFoundError(error)).toBe(false);
    });

    it('should return false for ThrottlingException', () => {
      const error = {
        name: 'ThrottlingException',
        message: 'Request throttled',
      };
      expect(isNotFoundError(error)).toBe(false);
    });
  });

  describe('handles edge cases', () => {
    it('should return false for null', () => {
      expect(isNotFoundError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isNotFoundError(undefined)).toBe(false);
    });

    it('should return false for string', () => {
      expect(isNotFoundError('NotFound')).toBe(false);
    });

    it('should return false for number', () => {
      expect(isNotFoundError(404)).toBe(false);
    });

    it('should return false for empty object', () => {
      expect(isNotFoundError({})).toBe(false);
    });

    it('should return false for object without name property', () => {
      const error = { message: 'Something went wrong' };
      expect(isNotFoundError(error)).toBe(false);
    });
  });
});
