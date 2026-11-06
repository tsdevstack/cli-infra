/**
 * Build the KQL subqueries ("legs") for one log source. Every leg returns
 * the same columns: TimeGenerated, Source, Kind, Level, Text, Raw.
 *
 * - Services and workers (Container Apps `{project}-{name}`): their output
 *   (ContainerAppConsoleLogs, app) and the platform's events
 *   (ContainerAppSystemLogs, platform)
 * - Migrations (Container Apps job `migrate-{service}`) and scheduled jobs
 *   (job `{project}-{name}`): the same tables. A scheduled job's output is a
 *   platform line, like its runs on the other providers.
 * - Kong and Next.js (App Service `{project}-{env}-{name}`): output
 *   (AppServiceConsoleLogs, app), container events (AppServicePlatformLogs)
 *   and requests (AppServiceHTTPLogs), platform
 * - Edge: Front Door's request and WAF logs (AzureDiagnostics); the line is
 *   built from Raw
 *
 * `--level` filters app lines on their JSON level here; lines without one
 * are left out, as on every provider.
 */

import {
  AZURE_FRONT_DOOR_LOG_CATEGORIES,
  LOG_LEVELS,
} from '../../../constants';
import type { LogKind, LogLevel, LogSource } from '../../logs/types';

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
  names: { projectName: string; targetEnv: string },
  options: { kind?: LogKind; level?: LogLevel },
): string[] {
  const { projectName, targetEnv } = names;
  const { kind, level } = options;
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
    case 'job': {
      const job = source.type === 'job' ? `${projectName}-${name}` : name;
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
      const site = `/sites/${projectName}-${targetEnv}-${name}`;
      legs.push({
        kind: 'app',
        kql: `AppServiceConsoleLogs | where _ResourceId endswith "${site}"${project('app', '""', 'ResultDescription')}${levelFilter}`,
      });
      legs.push({
        kind: 'platform',
        kql: `AppServicePlatformLogs | where _ResourceId endswith "${site}"${project('platform', 'Level', 'Message')}`,
      });
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
