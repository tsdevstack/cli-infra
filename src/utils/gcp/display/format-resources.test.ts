import { describe, it, expect } from '@rstest/core';
import { formatResources } from './format-resources';

describe('formatResources', () => {
  describe('Individual resources', () => {
    it('should format Cloud Run service', () => {
      const result = formatResources({
        cloudRunService: true,
        spaBucket: false,
        hasDatabase: false,
        secretCount: 0,
        hasServiceAccount: false,
      });
      expect(result).toBe('Cloud Run');
    });

    it('should format SPA bucket', () => {
      const result = formatResources({
        cloudRunService: false,
        spaBucket: true,
        hasDatabase: false,
        secretCount: 0,
        hasServiceAccount: false,
      });
      expect(result).toBe('SPA Bucket');
    });

    it('should format database', () => {
      const result = formatResources({
        cloudRunService: false,
        spaBucket: false,
        hasDatabase: true,
        secretCount: 0,
        hasServiceAccount: false,
      });
      expect(result).toBe('Database');
    });

    it('should format secrets with count', () => {
      const result = formatResources({
        cloudRunService: false,
        spaBucket: false,
        hasDatabase: false,
        secretCount: 5,
        hasServiceAccount: false,
      });
      expect(result).toBe('Secrets(5)');
    });

    it('should format service account', () => {
      const result = formatResources({
        cloudRunService: false,
        spaBucket: false,
        hasDatabase: false,
        secretCount: 0,
        hasServiceAccount: true,
      });
      expect(result).toBe('IAM');
    });
  });

  describe('Multiple resources', () => {
    it('should join multiple resources with comma', () => {
      const result = formatResources({
        cloudRunService: true,
        spaBucket: false,
        hasDatabase: true,
        secretCount: 3,
        hasServiceAccount: true,
      });
      expect(result).toBe('Cloud Run, Database, Secrets(3), IAM');
    });

    it('should include all resources when all are present', () => {
      const result = formatResources({
        cloudRunService: true,
        spaBucket: true,
        hasDatabase: true,
        secretCount: 10,
        hasServiceAccount: true,
      });
      expect(result).toBe('Cloud Run, SPA Bucket, Database, Secrets(10), IAM');
    });
  });

  describe('Edge cases', () => {
    it('should return "none" when no resources', () => {
      const result = formatResources({
        cloudRunService: false,
        spaBucket: false,
        hasDatabase: false,
        secretCount: 0,
        hasServiceAccount: false,
      });
      expect(result).toBe('none');
    });

    it('should not include secrets when count is 0', () => {
      const result = formatResources({
        cloudRunService: true,
        spaBucket: false,
        hasDatabase: false,
        secretCount: 0,
        hasServiceAccount: false,
      });
      expect(result).toBe('Cloud Run');
    });
  });
});
