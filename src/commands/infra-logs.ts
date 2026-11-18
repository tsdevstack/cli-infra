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
 *   npx tsdevstack infra:logs <source> --env <env> --follow  # new lines as they arrive
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
import { resolveGcpNamingScheme } from '../utils/gcp/naming/resolve-gcp-naming-scheme';
import { resolveAzureNaming } from '../utils/azure/naming/resolve-azure-naming';
import { getFrontdoorPremium } from '../utils/azure/infrastructure/get-frontdoor-premium';

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
    config.storage?.buckets ?? [],
  );

  let reader: LogsReader;
  if (ctx.provider === 'gcp') {
    const credentials = ctx.credentials as GCPCredentials;
    reader = new GcpLogsReader({
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials,
      naming: await resolveGcpNamingScheme(
        { projectName: ctx.projectName, targetEnv: ctx.targetEnv, credentials },
        'infra:logs',
      ),
    });
  } else if (ctx.provider === 'aws') {
    reader = new AwsLogsReader({
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials: ctx.credentials as AWSCredentials,
    });
  } else if (ctx.provider === 'azure') {
    const credentials = ctx.credentials as AzureCredentials;
    reader = new AzureLogsReader({
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials,
      naming: await resolveAzureNaming(
        credentials,
        ctx.projectName,
        ctx.targetEnv,
      ),
      appServicePrivate: getFrontdoorPremium(
        loadInfrastructureConfig(),
        ctx.targetEnv,
      ),
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
