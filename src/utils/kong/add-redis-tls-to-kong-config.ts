/**
 * Add Redis TLS settings to the Kong plugins that talk to Redis
 *
 * AWS ElastiCache and Azure Managed Redis require TLS connections. This adds
 * verified TLS (see addTlsToPlugin) to the `redis` block of every
 * rate-limiting and tsdevstack-api-key plugin: global plugins (the user's
 * rate limiter), service-level plugins (the per-IP ceiling and the API key
 * plugin on partner services) and consumer-level plugins.
 *
 * GCP Memorystore doesn't require this - it uses unencrypted connections
 * within the VPC.
 */

import type { KongTemplate } from '@tsdevstack/cli/plugin';
import { addTlsToPlugin } from './add-tls-to-plugin';

export function addRedisTlsToKongConfig(config: KongTemplate): KongTemplate {
  // Transform global plugins
  const plugins = config.plugins?.map(addTlsToPlugin);

  // Transform service-level plugins
  const services = config.services?.map((service) => {
    if (!service.plugins) return service;

    return {
      ...service,
      plugins: service.plugins.map(addTlsToPlugin),
    };
  });

  // Transform consumer-level plugins
  const consumers = config.consumers?.map((consumer) => {
    if (!consumer.plugins) return consumer;

    return {
      ...consumer,
      plugins: consumer.plugins.map(addTlsToPlugin),
    };
  });

  return {
    ...config,
    ...(plugins && { plugins }),
    ...(services && { services }),
    ...(consumers && { consumers }),
  };
}
