import { describe, it, expect } from '@rstest/core';
import { hasAnyResources } from './has-any-resources';
import type { DiscoveredResources } from '../discovery';

describe('hasAnyResources', () => {
  const createEmptyDiscovery = (): DiscoveredResources => ({
    cloudRunService: false,
    spaBucket: false,
    spaBucketName: '',
    secrets: [],
    database: false,
    databaseUser: false,
    serviceAccount: false,
    serviceAccountEmail: '',
    inferredType: 'unknown',
    hasDatabase: false,
  });

  it('should return false when no resources are discovered', () => {
    const discovered = createEmptyDiscovery();
    expect(hasAnyResources(discovered)).toBe(false);
  });

  it('should return true when Cloud Run service exists', () => {
    const discovered = createEmptyDiscovery();
    discovered.cloudRunService = true;
    expect(hasAnyResources(discovered)).toBe(true);
  });

  it('should return true when SPA bucket exists', () => {
    const discovered = createEmptyDiscovery();
    discovered.spaBucket = true;
    discovered.spaBucketName = 'my-spa-bucket';
    expect(hasAnyResources(discovered)).toBe(true);
  });

  it('should return true when secrets exist', () => {
    const discovered = createEmptyDiscovery();
    discovered.secrets = ['my-secret'];
    expect(hasAnyResources(discovered)).toBe(true);
  });

  it('should return true when database exists', () => {
    const discovered = createEmptyDiscovery();
    discovered.database = true;
    expect(hasAnyResources(discovered)).toBe(true);
  });

  it('should return true when service account exists', () => {
    const discovered = createEmptyDiscovery();
    discovered.serviceAccount = true;
    discovered.serviceAccountEmail = 'test@project.iam.gserviceaccount.com';
    expect(hasAnyResources(discovered)).toBe(true);
  });

  it('should return true when multiple resources exist', () => {
    const discovered = createEmptyDiscovery();
    discovered.cloudRunService = true;
    discovered.database = true;
    discovered.secrets = ['secret-1'];
    expect(hasAnyResources(discovered)).toBe(true);
  });
});
