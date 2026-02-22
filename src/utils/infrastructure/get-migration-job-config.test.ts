import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { getMigrationJobConfig } from './get-migration-job-config';
import {
  MIGRATION_JOB_DEFAULTS_GCP,
  MIGRATION_JOB_DEFAULTS_AWS,
  MIGRATION_JOB_DEFAULTS_AZURE,
} from '../../constants';

describe('getMigrationJobConfig', () => {
  describe('returns provider-specific defaults', () => {
    it('should return GCP defaults when config is null', () => {
      const result = getMigrationJobConfig(null, 'dev', 'gcp');
      expect(result).toEqual({
        cpu: MIGRATION_JOB_DEFAULTS_GCP.cpu,
        memory: MIGRATION_JOB_DEFAULTS_GCP.memory,
      });
    });

    it('should return AWS defaults when config is null', () => {
      const result = getMigrationJobConfig(null, 'dev', 'aws');
      expect(result).toEqual({
        cpu: MIGRATION_JOB_DEFAULTS_AWS.cpu,
        memory: MIGRATION_JOB_DEFAULTS_AWS.memory,
      });
    });

    it('should return Azure defaults when config is null', () => {
      const result = getMigrationJobConfig(null, 'dev', 'azure');
      expect(result).toEqual({
        cpu: MIGRATION_JOB_DEFAULTS_AZURE.cpu,
        memory: MIGRATION_JOB_DEFAULTS_AZURE.memory,
      });
    });

    it('should return defaults when environment does not exist', () => {
      const config = { prod: { database: { migrationJob: { cpu: '2' } } } };
      const result = getMigrationJobConfig(config, 'dev', 'gcp');
      expect(result).toEqual({
        cpu: MIGRATION_JOB_DEFAULTS_GCP.cpu,
        memory: MIGRATION_JOB_DEFAULTS_GCP.memory,
      });
    });

    it('should return defaults when env config is not an object', () => {
      const config = { dev: 'invalid' };
      const result = getMigrationJobConfig(
        config as Record<string, unknown>,
        'dev',
        'gcp',
      );
      expect(result).toEqual({
        cpu: MIGRATION_JOB_DEFAULTS_GCP.cpu,
        memory: MIGRATION_JOB_DEFAULTS_GCP.memory,
      });
    });

    it('should return defaults when no database key in env config', () => {
      const config = { dev: { redis: {} } };
      const result = getMigrationJobConfig(config, 'dev', 'gcp');
      expect(result).toEqual({
        cpu: MIGRATION_JOB_DEFAULTS_GCP.cpu,
        memory: MIGRATION_JOB_DEFAULTS_GCP.memory,
      });
    });

    it('should return defaults when no migrationJob in database config', () => {
      const config = { dev: { database: { tier: 'db-f1-micro' } } };
      const result = getMigrationJobConfig(config, 'dev', 'gcp');
      expect(result).toEqual({
        cpu: MIGRATION_JOB_DEFAULTS_GCP.cpu,
        memory: MIGRATION_JOB_DEFAULTS_GCP.memory,
      });
    });
  });

  describe('merges overrides with provider defaults', () => {
    it('should override cpu only (GCP)', () => {
      const config = {
        dev: { database: { migrationJob: { cpu: '0.5' } } },
      };
      const result = getMigrationJobConfig(config, 'dev', 'gcp');
      expect(result.cpu).toBe('0.5');
      expect(result.memory).toBe(MIGRATION_JOB_DEFAULTS_GCP.memory);
    });

    it('should override memory only (AWS)', () => {
      const config = {
        dev: { database: { migrationJob: { memory: '4096' } } },
      };
      const result = getMigrationJobConfig(config, 'dev', 'aws');
      expect(result.cpu).toBe(MIGRATION_JOB_DEFAULTS_AWS.cpu);
      expect(result.memory).toBe('4096');
    });

    it('should override both cpu and memory', () => {
      const config = {
        dev: { database: { migrationJob: { cpu: '2', memory: '4Gi' } } },
      };
      const result = getMigrationJobConfig(config, 'dev', 'gcp');
      expect(result).toEqual({ cpu: '2', memory: '4Gi' });
    });
  });

  describe('environment-specific config', () => {
    it('should get correct environment-specific config', () => {
      const config = {
        dev: { database: { migrationJob: { cpu: '0.5', memory: '512Mi' } } },
        prod: { database: { migrationJob: { cpu: '2', memory: '4Gi' } } },
      };
      const devResult = getMigrationJobConfig(config, 'dev', 'gcp');
      const prodResult = getMigrationJobConfig(config, 'prod', 'gcp');
      expect(devResult).toEqual({ cpu: '0.5', memory: '512Mi' });
      expect(prodResult).toEqual({ cpu: '2', memory: '4Gi' });
    });
  });

  describe('provider-specific default values', () => {
    it('should default GCP to 1 vCPU and 2Gi memory', () => {
      const result = getMigrationJobConfig(null, 'dev', 'gcp');
      expect(result.cpu).toBe('1');
      expect(result.memory).toBe('2Gi');
    });

    it('should default AWS to 1024 CPU units and 2048 MiB', () => {
      const result = getMigrationJobConfig(null, 'dev', 'aws');
      expect(result.cpu).toBe('1024');
      expect(result.memory).toBe('2048');
    });

    it('should default Azure to 1 vCPU and 2Gi memory', () => {
      const result = getMigrationJobConfig(null, 'dev', 'azure');
      expect(result.cpu).toBe('1');
      expect(result.memory).toBe('2Gi');
    });
  });
});
