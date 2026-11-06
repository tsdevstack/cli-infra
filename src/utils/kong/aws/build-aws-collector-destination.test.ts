import { describe, it, expect } from '@rstest/core';
import { buildAwsCollectorDestination } from './build-aws-collector-destination';

describe('buildAwsCollectorDestination', () => {
  describe('Standard use cases', () => {
    it("should sign for X-Ray and send to the region's OTLP endpoint", () => {
      const destination = buildAwsCollectorDestination({
        region: 'eu-west-1',
        logGroup: '/ecs/shop/kong',
      });

      expect(destination.extensions).toEqual({
        sigv4auth: { region: 'eu-west-1', service: 'xray' },
      });
      expect(destination.exporters).toEqual({
        otlp_http: {
          traces_endpoint: 'https://xray.eu-west-1.amazonaws.com/v1/traces',
          auth: { authenticator: 'sigv4auth' },
        },
      });
    });
  });

  describe('Edge cases', () => {
    it("should name Kong's log group so X-Ray finds its lines", () => {
      const destination = buildAwsCollectorDestination({
        region: 'eu-west-1',
        logGroup: '/ecs/shop/kong',
      });
      expect(destination.processors).toEqual({
        resource: {
          attributes: [
            {
              key: 'aws.log.group.names',
              value: '/ecs/shop/kong',
              action: 'upsert',
            },
            { key: 'cloud.provider', value: 'aws', action: 'upsert' },
            { key: 'cloud.region', value: 'eu-west-1', action: 'upsert' },
          ],
        },
      });
    });
  });
});
