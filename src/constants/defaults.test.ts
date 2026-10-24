import { describe, it, expect } from '@rstest/core';
import {
  GCP_DATABASE_CONNECTION_LIMITS,
  AWS_DATABASE_CONNECTION_LIMITS,
  AZURE_DATABASE_CONNECTION_LIMITS,
} from '@tsdevstack/infra-core';
import {
  VALID_DATABASE_TIERS_GCP,
  VALID_DATABASE_TIERS_AWS,
  VALID_DATABASE_TIERS_AZURE,
} from './defaults';

/**
 * The schema and validation accept VALID_DATABASE_TIERS_*; deploys size the
 * connection pool from infra-core's limits and fail on any other tier. The
 * two must name the same tiers.
 */
describe('database tiers', () => {
  it('should match the GCP tiers deploys can size a pool for', () => {
    expect([...VALID_DATABASE_TIERS_GCP].sort()).toEqual(
      Object.keys(GCP_DATABASE_CONNECTION_LIMITS).sort(),
    );
  });

  it('should match the AWS tiers deploys can size a pool for', () => {
    expect([...VALID_DATABASE_TIERS_AWS].sort()).toEqual(
      Object.keys(AWS_DATABASE_CONNECTION_LIMITS).sort(),
    );
  });

  it('should match the Azure tiers deploys can size a pool for', () => {
    expect([...VALID_DATABASE_TIERS_AZURE].sort()).toEqual(
      Object.keys(AZURE_DATABASE_CONNECTION_LIMITS).sort(),
    );
  });
});
