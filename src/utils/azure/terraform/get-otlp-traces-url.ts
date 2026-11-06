/**
 * Get OTLP Traces URL
 *
 * Reads where apps send spans on Azure (tracing.tf's data collection rule:
 * the otlp_traces_url output), for OTEL_EXPORTER_OTLP_TRACES_ENDPOINT.
 * Undefined, with a warning, while the environment has no such output yet
 * (infra:deploy creates it): the apps then keep the trace between them but
 * send no spans.
 */

import { getContext } from '../../../context';
import { getTerraformOutput } from '../../terraform';

export function getOtlpTracesUrl(
  terraformDir: string,
  tfEnv: Record<string, string>,
  targetEnv: string,
): string | undefined {
  try {
    const url = getTerraformOutput(terraformDir, 'otlp_traces_url', tfEnv);
    if (url) return url;
  } catch {
    // Created by tracing.tf; older environments don't have it yet
  }

  const { logger } = getContext();
  logger.warn(
    `No traces destination in this environment yet: traces are not sent. Run npx tsdevstack infra:deploy --env ${targetEnv} to create it.`,
  );
  return undefined;
}
