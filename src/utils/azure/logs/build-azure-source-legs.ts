/**
 * Build the KQL subqueries ("legs") for one log source. Every leg returns
 * the same columns: TimeGenerated, Source, Kind, Level, Text, Raw.
 *
 * - Services and workers (Container Apps `{project}-{name}`): their output
 *   (ContainerAppConsoleLogs, app) and the platform's events
 *   (ContainerAppSystemLogs, platform)
 * - Migrations (Container Apps job `migrate-{service}`), the database setup
 *   job (`db-init`) and scheduled jobs (job `{project}-{name}`): the same
 *   tables. A scheduled job's output is a platform line, like its runs on
 *   the other providers.
 * - Kong and Next.js (App Service `{project}-{env}-{name}`): output
 *   (AppServiceConsoleLogs, app), container events (AppServicePlatformLogs)
 *   and requests (AppServiceHTTPLogs), platform. With `appServiceLive`
 *   (--follow, the rest comes live from Kudu) only the requests.
 * - Storage buckets: the storage account's blob logs (StorageBlobLogs) of
 *   the bucket's container, platform, in the shape every provider uses
 *   (formatBucketAccessLine): operation, object, the status when it failed,
 *   who (the signed-in identity, else how it signed in: OAuth, SAS) and the
 *   caller's address
 * - Edge: Front Door's request and WAF logs (AzureDiagnostics); the line is
 *   built from Raw
 *
 * `--level` filters app lines on their JSON level here; lines without one
 * are left out, as on every provider.
 */

import {
  AZURE_DB_INIT_JOB_NAME,
  AZURE_FRONT_DOOR_LOG_CATEGORIES,
  LOG_LEVELS,
} from '../../../constants';
import type { LogKind, LogLevel, LogSource } from '../../logs/types';
import type { AzureNaming } from '@tsdevstack/cli/plugin';
import {
  buildAzureResourceName,
  buildAzureStorageContainerName,
} from '@tsdevstack/infra-core';

/** pino labels at or above each level (pino's trace counts as debug) */
const PINO_LABELS: Record<LogLevel, string[]> = {
  debug: ['trace', 'debug'],
  info: ['info'],
  warn: ['warn'],
  error: ['error'],
  fatal: ['fatal'],
};

export function buildAzureSourceLegs(
  source: LogSource,
  names: { projectName: string; targetEnv: string; naming: AzureNaming },
  options: { kind?: LogKind; level?: LogLevel; appServiceLive?: boolean },
): string[] {
  const { projectName, targetEnv } = names;
  const { kind, level, appServiceLive } = options;
  const name = source.name;

  const levelFilter = level
    ? ` | where tostring(parse_json(Text).level) in (${LOG_LEVELS.slice(
        LOG_LEVELS.indexOf(level),
      )
        .flatMap((l) => PINO_LABELS[l])
        .map((label) => `"${label}"`)
        .join(', ')})`
    : '';

  const legs: Array<{ kind: LogKind; kql: string }> = [];
  const project = (legKind: LogKind, levelExpr: string, textExpr: string) =>
    ` | extend Raw = pack_all() | project TimeGenerated, Source = "${name}", Kind = "${legKind}", Level = ${levelExpr}, Text = ${textExpr}, Raw`;
  const systemText = 'iff(isempty(Reason), Log, strcat(Reason, ": ", Log))';

  switch (source.type) {
    case 'service':
    case 'worker': {
      const app = `${projectName}-${name}`;
      legs.push({
        kind: 'app',
        kql: `ContainerAppConsoleLogs | where ContainerAppName == "${app}"${project('app', '""', 'Log')}${levelFilter}`,
      });
      legs.push({
        kind: 'platform',
        kql: `ContainerAppSystemLogs | where ContainerAppName == "${app}"${project('platform', 'Type', systemText)}`,
      });
      break;
    }
    case 'migration':
    case 'db-init':
    case 'job': {
      const job =
        source.type === 'job'
          ? `${projectName}-${name}`
          : source.type === 'db-init'
            ? AZURE_DB_INIT_JOB_NAME
            : name;
      // A job's executions are named {job}-{suffix}
      const match = `(ContainerAppName == "${job}" or JobName == "${job}" or JobName matches regex "^${job}-[a-z0-9]+$")`;
      const outputKind: LogKind = source.type === 'job' ? 'platform' : 'app';
      legs.push({
        kind: outputKind,
        kql: `ContainerAppConsoleLogs | where ${match}${project(outputKind, '""', 'Log')}${outputKind === 'app' ? levelFilter : ''}`,
      });
      legs.push({
        kind: 'platform',
        kql: `ContainerAppSystemLogs | where ${match}${project('platform', 'Type', systemText)}`,
      });
      break;
    }
    case 'kong':
    case 'frontend': {
      // The App Service's name in this environment (old or unique scheme)
      const site = `/sites/${buildAzureResourceName('appService', {
        projectName,
        environment: targetEnv,
        naming: names.naming.scheme,
        subscriptionId: names.naming.subscriptionId,
        app: name,
      })}`;
      if (!appServiceLive) {
        legs.push({
          kind: 'app',
          kql: `AppServiceConsoleLogs | where _ResourceId endswith "${site}"${project('app', '""', 'ResultDescription')}${levelFilter}`,
        });
        legs.push({
          kind: 'platform',
          kql: `AppServicePlatformLogs | where _ResourceId endswith "${site}"${project('platform', 'Level', 'Message')}`,
        });
      }
      legs.push({
        kind: 'platform',
        kql: `AppServiceHTTPLogs | where _ResourceId endswith "${site}"${project(
          'platform',
          'iff(ScStatus >= 500, "error", iff(ScStatus >= 400, "warn", "info"))',
          'strcat(CsMethod, " ", CsUriStem, iff(isempty(CsUriQuery) or CsUriQuery == "-", "", strcat("?", CsUriQuery)), " ", ScStatus, " ", TimeTaken, "ms")',
        )}`,
      });
      break;
    }
    case 'bucket': {
      if (!source.bucket) {
        break;
      }
      const account = buildAzureResourceName('blobStorageAccount', {
        projectName,
        environment: targetEnv,
        naming: names.naming.scheme,
        subscriptionId: names.naming.subscriptionId,
      });
      // ObjectKey: /{account}/{container}/{blob}, or the container for a list.
      // The container is {project}-{bucket}-{env}, not the config name
      const container = `/${account}/${buildAzureStorageContainerName({
        projectName,
        bucket: source.bucket,
        environment: targetEnv,
      })}`;
      const ip =
        'iff(CallerIpAddress matches regex @"^.+:[0-9]+$", extract(@"^(.+):[0-9]+$", 1, CallerIpAddress), CallerIpAddress)';
      const text = [
        'OperationName',
        '" "',
        `iff(ObjectKey startswith "${container}/", substring(ObjectKey, ${container.length + 1}), "(bucket)")`,
        'iff(toint(StatusCode) >= 400, strcat(" ", StatusCode, " ", StatusText), "")',
        'iff(isempty(coalesce(RequesterUpn, AuthenticationType)), "", strcat(" by ", coalesce(RequesterUpn, AuthenticationType)))',
        `iff(isempty(CallerIpAddress), "", strcat(" from ", ${ip}))`,
      ].join(', ');
      legs.push({
        kind: 'platform',
        kql: `StorageBlobLogs | where AccountName == "${account}" and (ObjectKey == "${container}" or ObjectKey startswith "${container}/")${project(
          'platform',
          'iff(toint(StatusCode) >= 500, "error", iff(toint(StatusCode) >= 400, "warn", "info"))',
          `strcat(${text})`,
        )}`,
      });
      break;
    }
    case 'edge':
      legs.push({
        kind: 'edge',
        kql: `AzureDiagnostics | where Category in (${AZURE_FRONT_DOOR_LOG_CATEGORIES.map((c) => `"${c}"`).join(', ')})${project('edge', '""', '""')}`,
      });
      break;
  }

  return legs
    .filter((leg) => !kind || leg.kind === kind)
    .map((leg) => `(${leg.kql})`);
}
