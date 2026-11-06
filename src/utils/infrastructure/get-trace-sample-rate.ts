/**
 * Get the trace sample rate of an environment from infrastructure.json
 */

import { DEFAULT_TRACE_SAMPLE_RATE } from '@tsdevstack/infra-core';
import type { EnvironmentOverrides } from './types';

/**
 * tracing.sampleRate of the environment, or the default (keep every trace)
 */
export function getTraceSampleRate(
  config: { [env: string]: unknown } | null,
  environment: string,
): number {
  const envConfig = config?.[environment] as EnvironmentOverrides | undefined;
  const sampleRate = envConfig?.tracing?.sampleRate;
  return typeof sampleRate === 'number'
    ? sampleRate
    : DEFAULT_TRACE_SAMPLE_RATE;
}
