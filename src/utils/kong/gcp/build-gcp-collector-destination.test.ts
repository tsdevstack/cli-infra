import { describe, it, expect } from '@rstest/core';
import { buildGcpCollectorDestination } from './build-gcp-collector-destination';

describe('buildGcpCollectorDestination', () => {
  describe('Standard use cases', () => {
    it("should send to Google's OTLP endpoint with Kong's account token", () => {
      const destination = buildGcpCollectorDestination('shop-dev');

      expect(destination.extensions).toEqual({ google_client_auth: {} });
      expect(destination.exporters).toEqual({
        otlp_http: {
          traces_endpoint: 'https://telemetry.googleapis.com/v1/traces',
          auth: { authenticator: 'google_client_auth' },
        },
      });
    });
  });

  describe('Edge cases', () => {
    it('should add the project Google requires on every span', () => {
      expect(buildGcpCollectorDestination('shop-dev').processors).toEqual({
        resource: {
          attributes: [
            { key: 'gcp.project_id', value: 'shop-dev', action: 'upsert' },
            { key: 'cloud.provider', value: 'gcp', action: 'upsert' },
          ],
        },
      });
    });
  });
});
