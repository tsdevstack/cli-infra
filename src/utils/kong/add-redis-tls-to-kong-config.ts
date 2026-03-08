/**
 * Add Redis TLS settings to Kong rate-limiting plugins
 *
 * AWS ElastiCache and Azure Managed Redis require TLS connections.
 * This function adds ssl: true and ssl_verify: false to all rate-limiting
 * plugin Redis configs in the Kong configuration.
 *
 * GCP Memorystore doesn't require this - it uses unencrypted connections
 * within the VPC.
 */

import type { KongTemplate } from '@tsdevstack/cli/plugin';
import { addTlsToPlugin } from './add-tls-to-plugin';

export function addRedisTlsToKongConfig(config: KongTemplate): KongTemplate {
  // Transform global plugins
  const plugins = config.plugins?.map(addTlsToPlugin);

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
    ...(consumers && { consumers }),
  };
}
