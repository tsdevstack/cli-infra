import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { mergeDatabaseWithDefaults } from './merge-database-with-defaults';
import {
  DATABASE_DEFAULTS_GCP,
  DATABASE_DEFAULTS_AWS,
  DATABASE_DEFAULTS_AZURE,
} from '../../constants';

describe('mergeDatabaseWithDefaults', () => {
  describe('GCP provider', () => {
    describe('returns defaults', () => {
      it('should return all GCP defaults when override is undefined', () => {
        const result = mergeDatabaseWithDefaults(undefined, 'gcp');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_GCP.tier,
          diskSize: DATABASE_DEFAULTS_GCP.diskSize,
          deletionProtection: DATABASE_DEFAULTS_GCP.deletionProtection,
          ha: DATABASE_DEFAULTS_GCP.ha,
          backup: DATABASE_DEFAULTS_GCP.backup,
        });
      });

      it('should return all GCP defaults when override is empty object', () => {
        const result = mergeDatabaseWithDefaults({}, 'gcp');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_GCP.tier,
          diskSize: DATABASE_DEFAULTS_GCP.diskSize,
          deletionProtection: DATABASE_DEFAULTS_GCP.deletionProtection,
          ha: DATABASE_DEFAULTS_GCP.ha,
          backup: DATABASE_DEFAULTS_GCP.backup,
        });
      });
    });

    describe('merges overrides', () => {
      it('should override tier only', () => {
        const result = mergeDatabaseWithDefaults(
          { tier: 'db-g1-small' },
          'gcp',
        );
        expect(result.tier).toBe('db-g1-small');
        expect(result.diskSize).toBe(DATABASE_DEFAULTS_GCP.diskSize);
        expect(result.ha).toBe(DATABASE_DEFAULTS_GCP.ha);
        expect(result.backup).toBe(DATABASE_DEFAULTS_GCP.backup);
      });

      it('should override diskSize only', () => {
        const result = mergeDatabaseWithDefaults({ diskSize: 50 }, 'gcp');
        expect(result.tier).toBe(DATABASE_DEFAULTS_GCP.tier);
        expect(result.diskSize).toBe(50);
        expect(result.ha).toBe(DATABASE_DEFAULTS_GCP.ha);
        expect(result.backup).toBe(DATABASE_DEFAULTS_GCP.backup);
      });

      it('should override ha only', () => {
        const result = mergeDatabaseWithDefaults({ ha: true }, 'gcp');
        expect(result.tier).toBe(DATABASE_DEFAULTS_GCP.tier);
        expect(result.diskSize).toBe(DATABASE_DEFAULTS_GCP.diskSize);
        expect(result.ha).toBe(true);
        expect(result.backup).toBe(DATABASE_DEFAULTS_GCP.backup);
      });

      it('should override backup only', () => {
        const result = mergeDatabaseWithDefaults({ backup: true }, 'gcp');
        expect(result.tier).toBe(DATABASE_DEFAULTS_GCP.tier);
        expect(result.diskSize).toBe(DATABASE_DEFAULTS_GCP.diskSize);
        expect(result.ha).toBe(DATABASE_DEFAULTS_GCP.ha);
        expect(result.backup).toBe(true);
      });

      it('should override deletionProtection only', () => {
        const result = mergeDatabaseWithDefaults(
          { deletionProtection: false },
          'gcp',
        );
        expect(result.tier).toBe(DATABASE_DEFAULTS_GCP.tier);
        expect(result.diskSize).toBe(DATABASE_DEFAULTS_GCP.diskSize);
        expect(result.deletionProtection).toBe(false);
        expect(result.ha).toBe(DATABASE_DEFAULTS_GCP.ha);
        expect(result.backup).toBe(DATABASE_DEFAULTS_GCP.backup);
      });

      it('should override all fields', () => {
        const result = mergeDatabaseWithDefaults(
          {
            tier: 'db-custom-2-4096',
            diskSize: 100,
            deletionProtection: false,
            ha: true,
            backup: true,
          },
          'gcp',
        );
        expect(result).toEqual({
          tier: 'db-custom-2-4096',
          diskSize: 100,
          deletionProtection: false,
          ha: true,
          backup: true,
        });
      });
    });
  });

  describe('AWS provider', () => {
    describe('returns defaults', () => {
      it('should return all AWS defaults when override is undefined', () => {
        const result = mergeDatabaseWithDefaults(undefined, 'aws');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_AWS.tier,
          diskSize: DATABASE_DEFAULTS_AWS.diskSize,
          deletionProtection: DATABASE_DEFAULTS_AWS.deletionProtection,
          ha: DATABASE_DEFAULTS_AWS.ha,
          backup: DATABASE_DEFAULTS_AWS.backup,
        });
      });

      it('should return all AWS defaults when override is empty object', () => {
        const result = mergeDatabaseWithDefaults({}, 'aws');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_AWS.tier,
          diskSize: DATABASE_DEFAULTS_AWS.diskSize,
          deletionProtection: DATABASE_DEFAULTS_AWS.deletionProtection,
          ha: DATABASE_DEFAULTS_AWS.ha,
          backup: DATABASE_DEFAULTS_AWS.backup,
        });
      });
    });

    describe('merges overrides', () => {
      it('should override tier only with AWS tier', () => {
        const result = mergeDatabaseWithDefaults(
          { tier: 'db.t3.small' },
          'aws',
        );
        expect(result.tier).toBe('db.t3.small');
        expect(result.diskSize).toBe(DATABASE_DEFAULTS_AWS.diskSize);
        expect(result.ha).toBe(DATABASE_DEFAULTS_AWS.ha);
        expect(result.backup).toBe(DATABASE_DEFAULTS_AWS.backup);
      });

      it('should override all fields', () => {
        const result = mergeDatabaseWithDefaults(
          {
            tier: 'db.r5.large',
            diskSize: 100,
            deletionProtection: false,
            ha: true,
            backup: true,
          },
          'aws',
        );
        expect(result).toEqual({
          tier: 'db.r5.large',
          diskSize: 100,
          deletionProtection: false,
          ha: true,
          backup: true,
        });
      });
    });
  });

  describe('Azure provider', () => {
    describe('returns defaults', () => {
      it('should return all Azure defaults when override is undefined', () => {
        const result = mergeDatabaseWithDefaults(undefined, 'azure');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_AZURE.tier,
          diskSize: DATABASE_DEFAULTS_AZURE.diskSize,
          deletionProtection: DATABASE_DEFAULTS_AZURE.deletionProtection,
          ha: DATABASE_DEFAULTS_AZURE.ha,
          backup: DATABASE_DEFAULTS_AZURE.backup,
        });
      });

      it('should return all Azure defaults when override is empty object', () => {
        const result = mergeDatabaseWithDefaults({}, 'azure');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_AZURE.tier,
          diskSize: DATABASE_DEFAULTS_AZURE.diskSize,
          deletionProtection: DATABASE_DEFAULTS_AZURE.deletionProtection,
          ha: DATABASE_DEFAULTS_AZURE.ha,
          backup: DATABASE_DEFAULTS_AZURE.backup,
        });
      });
    });

    describe('merges overrides', () => {
      it('should override tier only with Azure tier', () => {
        const result = mergeDatabaseWithDefaults(
          { tier: 'GP_Standard_D2s_v3' },
          'azure',
        );
        expect(result.tier).toBe('GP_Standard_D2s_v3');
        expect(result.diskSize).toBe(DATABASE_DEFAULTS_AZURE.diskSize);
      });

      it('should override all fields', () => {
        const result = mergeDatabaseWithDefaults(
          {
            tier: 'GP_Standard_D4s_v3',
            diskSize: 64,
            deletionProtection: false,
            ha: true,
            backup: true,
          },
          'azure',
        );
        expect(result).toEqual({
          tier: 'GP_Standard_D4s_v3',
          diskSize: 64,
          deletionProtection: false,
          ha: true,
          backup: true,
        });
      });
    });
  });

  describe('serverName override', () => {
    it('should leave serverName out when not set', () => {
      const result = mergeDatabaseWithDefaults(
        { tier: 'B_Standard_B2s' },
        'azure',
      );
      expect('serverName' in result).toBe(false);
    });

    it('should leave serverName out when override is undefined', () => {
      const result = mergeDatabaseWithDefaults(undefined, 'azure');
      expect('serverName' in result).toBe(false);
    });

    it('should pass serverName through when set', () => {
      const result = mergeDatabaseWithDefaults(
        { serverName: 'myapp-dev-postgres-2' },
        'azure',
      );
      expect(result.serverName).toBe('myapp-dev-postgres-2');
      expect(result.tier).toBe(DATABASE_DEFAULTS_AZURE.tier);
    });
  });

  describe('provider-specific defaults differ', () => {
    it('should have different default tiers for GCP vs AWS vs Azure', () => {
      const gcpResult = mergeDatabaseWithDefaults(undefined, 'gcp');
      const awsResult = mergeDatabaseWithDefaults(undefined, 'aws');
      const azureResult = mergeDatabaseWithDefaults(undefined, 'azure');
      expect(gcpResult.tier).toBe('db-f1-micro'); // GCP Cloud SQL
      expect(awsResult.tier).toBe('db.t3.micro'); // AWS RDS
      expect(azureResult.tier).toBe('B_Standard_B1ms'); // Azure Flexible Server
    });
  });
});
