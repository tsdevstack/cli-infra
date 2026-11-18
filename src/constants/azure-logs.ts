/**
 * Azure constants for infra:logs (Log Analytics)
 */

/** Resource group of an environment: `{project}-{env}-rg` */
export const AZURE_RESOURCE_GROUP_SUFFIX = '-rg';

/** Log Analytics workspace of an environment: `{project}-{env}-logs` */
export const AZURE_LOG_WORKSPACE_SUFFIX = '-logs';

/**
 * Reads go slice by slice, so lines come out as they arrive and no query
 * reaches Log Analytics' 500,000-row limit
 */
export const AZURE_LOGS_SLICE_MINUTES = 15;

/** Front Door's request and WAF logs (in the AzureDiagnostics table) */
export const AZURE_FRONT_DOOR_LOG_CATEGORIES = [
  'FrontDoorAccessLog',
  'FrontDoorWebApplicationFirewallLog',
] as const;

/**
 * --follow: sources with a live stream from Container Apps. App Service
 * (Kong, Next.js) streams from Kudu (AZURE_KUDU_LOG_SOURCE_TYPES); jobs,
 * buckets and edge come from Log Analytics.
 */
export const AZURE_LIVE_LOG_SOURCE_TYPES = ['service', 'worker'] as const;

/**
 * --follow: App Service sources, streamed live from their Kudu site's log
 * stream (`https://{app}.scm.azurewebsites.net/api/logstream`). Kudu sends
 * what App Service writes to /home/LogFiles (container logging, on in the
 * generated Terraform): the containers' output and the platform's events,
 * about 1 to 3 seconds after they're written (az6, 2026-11-18). It signs in
 * with an App Service token of the environment's credentials (publish
 * rights on the app, in Contributor).
 */
export const AZURE_KUDU_LOG_SOURCE_TYPES = ['kong', 'frontend'] as const;

/** --follow: an App Service app's Kudu host is `{app}{suffix}` */
export const AZURE_KUDU_HOST_SUFFIX = '.scm.azurewebsites.net';

/** --follow: Kudu's log stream */
export const AZURE_KUDU_LOG_STREAM_PATH = '/api/logstream';

/** --follow: the token Kudu takes (Azure CLI's `az webapp log tail` asks for it too) */
export const AZURE_KUDU_TOKEN_SCOPE = 'https://appservice.azure.com/.default';

/**
 * --follow: Kudu first sends the last 10 lines of each log file, under a
 * line with the file's path; this line starts the new ones. Live lines no
 * longer say which file they come from.
 */
export const AZURE_KUDU_LIVE_MARKER = /^Starting Live Log Stream/;

/**
 * --follow: a line App Service wrote to a log file: an ISO time with
 * fractions and Z, then the line (`2026-11-18T07:46:14.4083994Z ...`).
 * Kudu's own trace (`2026-11-18T07:46:30  Error occurred, ...`, no
 * fractions, no Z), its welcome and the file headers don't match.
 */
export const AZURE_KUDU_LOG_LINE =
  /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z) (.*)$/;

/**
 * --follow: lines of the Kudu site's own container (it starts on the first
 * request), left out
 */
export const AZURE_KUDU_OWN_LINES: readonly RegExp[] = [
  /^log4net:/,
  /^(Startup|Configure Services|Configure|Setting Up Routes|Exiting Configure) : \d/,
  /^Hosting environment: /,
  /^Content root path: \/opt\/Kudu/,
  /^Now listening on: http:\/\/[^\s]+:8181$/,
  /^Application started\. Press Ctrl\+C to shut down\.$/,
];

/**
 * --follow: a platform line's level. One with a level of its own (`WARN  -`)
 * keeps it; otherwise one with these words is an error, the rest info.
 */
export const AZURE_APP_SERVICE_PLATFORM_LEVEL_PREFIX =
  /^(INFO|WARN|ERROR|DEBUG) +- /;
export const AZURE_APP_SERVICE_PLATFORM_ERROR =
  /fail|prohibit|\bblocked\b|terminated during|exited|didn't respond|did not respond|LastError: [^,\s]/i;

/** --follow: how often a followed app's replicas are checked for new ones */
export const AZURE_LOGS_FOLLOW_REPLICA_CHECK_MS = 10_000;

/**
 * --follow: earlier lines a replica that started after the command sends
 * when its stream opens (Azure's maximum), so it shows from its first line
 */
export const AZURE_LOG_STREAM_NEW_REPLICA_TAIL_LINES = 300;

/** --follow: how often Log Analytics is asked for the sources without a stream */
export const AZURE_LOGS_FOLLOW_POLL_MS = 30_000;

/**
 * --follow: each Log Analytics check looks this far back past the previous
 * one (lines reach the workspace 1 to 10 minutes late); lines already
 * printed are skipped
 */
export const AZURE_LOGS_FOLLOW_OVERLAP_MS = 15 * 60_000;

/**
 * --follow: App Service's own events in the stream (its platform log:
 * pulling the image, starting and stopping containers), shown as
 * `platform` lines. The stream doesn't say which file a line comes from,
 * so these are told apart by their shape (az6's platform log,
 * 2026-11-18); anything else is the app's output.
 */
export const AZURE_APP_SERVICE_PLATFORM_LINES: readonly RegExp[] = [
  /^State: \w+, Action: \w+, LastError:/,
  AZURE_APP_SERVICE_PLATFORM_LEVEL_PREFIX,
  /^(Container|Site container) (is |start |spec |pull |exited|terminated|didn't|did not|failed)/,
  /^Site(: \S+)? (started|stopped|will be blocked|is unblocked)/,
  /^Site container: /,
  /^Site startup probe /,
  /^(Establishing|Mounting volumes|Creating container|Creating pipes|Starting watchers|Starting metrics|Nested mountpoint|Pulling image: |Stopping container: |Deleting container: |Failed to start site|Start site prohibit)/,
];
