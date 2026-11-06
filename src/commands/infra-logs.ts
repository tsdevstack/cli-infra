/**
 * infra:logs Command
 *
 * Read the logs of a deployed environment: services, workers, frontends,
 * Kong, migration runs, scheduled jobs, platform and edge, in one timeline.
 *
 * Usage:
 *   npx tsdevstack infra:logs --env <env>                  # list the sources
 *   npx tsdevstack infra:logs <source> --env <env>         # one source
 *   npx tsdevstack infra:logs --all --env <env>            # every source
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { loadInfrastructureConfig } from '../utils/infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../utils/infrastructure/get-scheduled-jobs';
import { buildLogSources } from '../utils/logs/build-log-sources';
import { runLogsCommand } from '../utils/logs/run-logs-command';
import { GcpLogsReader } from '../utils/gcp/logs/gcp-logs-reader';
import { AwsLogsReader } from '../utils/aws/logs/aws-logs-reader';
import { AzureLogsReader } from '../utils/azure/logs/azure-logs-reader';
import type { InfraLogsOptions, LogsReader } from '../utils/logs/types';
import type {
  AWSCredentials,
  AzureCredentials,
  GCPCredentials,
} from '@tsdevstack/cli/plugin';

export async function infraLogs(
  sourceName: string | undefined,
  options: InfraLogsOptions,
): Promise<void> {
  const { CliError, loadFrameworkConfig } = getContext();

  const ctx = await setupInfraCommand(options, 'infra:logs');
  const config = loadFrameworkConfig();
  const sources = buildLogSources(
    config.services,
    getScheduledJobs(loadInfrastructureConfig(), ctx.targetEnv),
  );

  let reader: LogsReader;
  if (ctx.provider === 'gcp') {
    reader = new GcpLogsReader({
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials: ctx.credentials as GCPCredentials,
    });
  } else if (ctx.provider === 'aws') {
    reader = new AwsLogsReader({
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials: ctx.credentials as AWSCredentials,
    });
  } else if (ctx.provider === 'azure') {
    reader = new AzureLogsReader({
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials: ctx.credentials as AzureCredentials,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${String(ctx.provider)}`,
      'infra:logs',
      'Supported providers: gcp, aws, azure',
    );
  }

  await runLogsCommand({
    reader,
    sourceName,
    options,
    targetEnv: ctx.targetEnv,
    sources,
    now: new Date(),
  });
}
