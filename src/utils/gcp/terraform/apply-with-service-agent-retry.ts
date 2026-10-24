/**
 * Apply With Service Agent Retry
 *
 * Runs a Terraform apply on GCP and, when it failed only because Google was
 * still creating the project's Service Networking service agent (the first
 * deploy of a new project, see isServiceNetworkingAgentRace), waits and
 * applies again. Terraform continues where it stopped. Any other failure
 * returns at once.
 */

import { sleep } from '@tsdevstack/infra-core';
import type { TerraformResult } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import {
  GCP_SERVICE_AGENT_RETRY_ATTEMPTS,
  GCP_SERVICE_AGENT_RETRY_DELAY_MS,
} from '../../../constants';
import { isServiceNetworkingAgentRace } from './is-service-networking-agent-race';

interface ServiceAgentRetryOptions {
  retries?: number;
  delayMs?: number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Apply, and apply again while the Service Networking agent is being created
 *
 * @param apply - Runs terraform apply
 * @param options - Retries, delay and the wait function (tests)
 * @returns The last apply's result
 */
export async function applyWithServiceAgentRetry(
  apply: () => Promise<TerraformResult>,
  options: ServiceAgentRetryOptions = {},
): Promise<TerraformResult> {
  const { logger } = getContext();
  const retries = options.retries ?? GCP_SERVICE_AGENT_RETRY_ATTEMPTS;
  const delayMs = options.delayMs ?? GCP_SERVICE_AGENT_RETRY_DELAY_MS;
  const wait = options.wait ?? sleep;

  let result = await apply();

  for (let retry = 1; retry <= retries; retry++) {
    if (result.success || !isServiceNetworkingAgentRace(result.output)) {
      return result;
    }

    logger.newline();
    logger.warn(
      'Google is still setting up Service Networking for this project (first deploy of a new project). This is not a credentials problem.',
    );
    logger.info(
      `Applying again in ${delayMs / 1000} seconds (retry ${retry} of ${retries})...`,
    );
    logger.newline();

    await wait(delayMs);
    result = await apply();
  }

  return result;
}
