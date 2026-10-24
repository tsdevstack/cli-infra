import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockGetToken = rs.fn();

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: () => ({
    getToken: mockGetToken,
  }),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

const mockFetch = rs.fn();
rs.stubGlobal('fetch', mockFetch);

import { checkPostgresAvailability } from './check-postgres-availability';

const credentials = {
  subscriptionId: 'sub-123',
  tenantId: 'tenant-456',
  clientId: 'client-789',
  clientSecret: 'secret-abc',
  location: 'eastus',
};

describe('checkPostgresAvailability', () => {
  beforeEach(() => {
    rs.resetAllMocks();
    mockGetToken.mockResolvedValue({ token: 'test-token' });
  });

  it('should return available when capabilities exist', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: [{ name: 'some-sku' }] }),
    });

    const result = await checkPostgresAvailability(credentials);

    expect(result.available).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should return unavailable when capabilities are empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: [] }),
    });

    const result = await checkPostgresAvailability(credentials);

    expect(result.available).toBe(false);
    expect(result.error).toContain('not available');
    expect(result.error).toContain('eastus');
  });

  it('should return unavailable when value is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await checkPostgresAvailability(credentials);

    expect(result.available).toBe(false);
  });

  it('should suggest alternative regions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: [] }),
    });

    const result = await checkPostgresAvailability(credentials);

    expect(result.error).toContain('eastus2');
    expect(result.error).toContain('centralus');
    expect(result.error).toContain('westus2');
  });

  it('should mention credentials file in error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: [] }),
    });

    const result = await checkPostgresAvailability(credentials);

    expect(result.error).toContain('.tsdevstack/.credentials.azure.json');
  });

  it('should handle HTTP errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({}),
    });

    const result = await checkPostgresAvailability(credentials);

    expect(result.available).toBe(false);
    expect(result.error).toContain('HTTP 403');
  });

  it('should call correct Azure REST API endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: [{ name: 'sku' }] }),
    });

    await checkPostgresAvailability(credentials);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/subscriptions/sub-123/providers/Microsoft.DBforPostgreSQL/locations/eastus/capabilities',
      ),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  describe('zone-redundant high availability', () => {
    it('should pass when the region reports zoneRedundantHaSupported Enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [
              {
                name: 'FlexibleServerCapabilities',
                zoneRedundantHaSupported: 'Enabled',
              },
            ],
          }),
      });

      const result = await checkPostgresAvailability(credentials, {
        zoneRedundantHa: true,
      });

      expect(result.available).toBe(true);
    });

    it('should pass when the ZoneRedundantHa feature is Enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [
              {
                name: 'FlexibleServerCapabilities',
                supportedFeatures: [
                  { name: 'ZoneRedundantHa', status: 'Enabled' },
                ],
              },
            ],
          }),
      });

      const result = await checkPostgresAvailability(credentials, {
        zoneRedundantHa: true,
      });

      expect(result.available).toBe(true);
    });

    it('should fail when the region reports zone-redundant HA as Disabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [
              {
                name: 'FlexibleServerCapabilities',
                zoneRedundantHaSupported: 'Disabled',
              },
            ],
          }),
      });

      const result = await checkPostgresAvailability(credentials, {
        zoneRedundantHa: true,
      });

      expect(result.available).toBe(false);
      expect(result.error).toContain('zone-redundant high availability');
      expect(result.error).toContain("'eastus'");
    });

    it('should not block when the region does not report zone redundancy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ value: [{ name: 'FlexibleServerCapabilities' }] }),
      });

      const result = await checkPostgresAvailability(credentials, {
        zoneRedundantHa: true,
      });

      expect(result.available).toBe(true);
    });

    it('should ignore zone redundancy when ha is off', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [
              {
                name: 'FlexibleServerCapabilities',
                zoneRedundantHaSupported: 'Disabled',
              },
            ],
          }),
      });

      const result = await checkPostgresAvailability(credentials);

      expect(result.available).toBe(true);
    });
  });
});
