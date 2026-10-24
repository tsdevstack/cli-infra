/**
 * Apply With Capacity Retry
 *
 * Runs a Terraform apply and, when it failed only because the cloud provider
 * has no capacity right now (a size in a region or zone), waits and applies
 * again. Terraform continues where it stopped, and the provider may place the
 * resource where capacity is free. Every provider documents these shortages
 * as transient. Any other failure returns at once.
 */

import { isCapacityOnlyFailure, sleep } from '@tsdevstack/infra-core';
import type { CloudProvider, TerraformResult } from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import {
  CAPACITY_RETRY_ATTEMPTS,
  CAPACITY_RETRY_DELAY_MS,
} from '../../constants';

interface CapacityRetryOptions {
  retries?: number;
  delayMs?: number;
  wait?: (ms: number) => Promise<void>;
}

export async function applyWithCapacityRetry(
  apply: () => Promise<TerraformResult>,
  provider: CloudProvider,
  options: CapacityRetryOptions = {},
): Promise<TerraformResult> {
  const { logger, CliError } = getContext();
  const retries = options.retries ?? CAPACITY_RETRY_ATTEMPTS;
  const delayMs = options.delayMs ?? CAPACITY_RETRY_DELAY_MS;
  const wait = options.wait ?? sleep;

  let result = await apply();

  for (let retry = 1; retry <= retries; retry++) {
    if (result.success || !isCapacityOnlyFailure(result.output, provider)) {
      return result;
    }

    logger.newline();
    logger.warn(
      'The cloud provider has no capacity for a resource in this region right now. This is not a quota or configuration error.',
    );
    logger.info(
      `Applying again in ${delayMs / 60_000} minutes (retry ${retry} of ${retries})...`,
    );
    logger.newline();

    await wait(delayMs);
    result = await apply();
  }

  if (!result.success && isCapacityOnlyFailure(result.output, provider)) {
    throw new CliError(
      `The cloud provider still has no capacity after ${retries} retries`,
      'infra:deploy',
      'This is not a configuration error. Run infra:deploy again later (it continues where it stopped), choose another size (database.tier or redis.tier in .tsdevstack/infrastructure.json), or ask the provider for capacity in this region.',
    );
  }

  return result;
}
