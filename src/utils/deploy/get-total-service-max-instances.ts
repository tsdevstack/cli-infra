/**
 * Thin wrapper — delegates to infra-core (moved in Phase 25c Session 4)
 *
 * Preserves old signature (infraConfig, targetEnv, provider) for cli-infra callers.
 * Adapts to infra-core's callback-based signature.
 */

import { getTotalServiceMaxInstances as infraCoreGetTotalServiceMaxInstances } from '@tsdevstack/infra-core';
import { getServiceConfig } from '../infrastructure/get-service-config';
import type {
  InfrastructureConfig,
  InfraProvider,
} from '../infrastructure/types';

export function getTotalServiceMaxInstances(
  services: Array<{
    name: string;
    type: string;
    hasDatabase?: boolean;
    baseService?: string;
  }>,
  infraConfig: InfrastructureConfig | null,
  targetEnv: string,
  provider: InfraProvider,
): number {
  return infraCoreGetTotalServiceMaxInstances(
    services,
    (serviceName: string) =>
      getServiceConfig(infraConfig, serviceName, targetEnv, provider)
        .maxInstances,
  );
}
