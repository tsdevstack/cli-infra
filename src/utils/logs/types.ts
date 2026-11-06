/**
 * infra:logs Types
 *
 * Shared by the command and the provider readers (GCP, AWS, Azure).
 */

import type { LOG_LEVELS, LOG_KINDS } from '../../constants';

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogKind = (typeof LOG_KINDS)[number];

export type LogSourceType =
  'service' | 'worker' | 'frontend' | 'kong' | 'migration' | 'job' | 'edge';

/**
 * One place logs come from. `name` is what the user types and what every
 * line shows: auth-service, auth-worker, kong, migrate-auth-service, a
 * scheduled job's name, edge.
 */
export interface LogSource {
  name: string;
  type: LogSourceType;
  /** Scheduled jobs: the service the job calls */
  service?: string;
}

/**
 * One log line, the same shape on every provider
 */
export interface LogEntry {
  /** ISO 8601, UTC */
  time: string;
  /** LogSource name */
  source: string;
  kind: LogKind;
  /** Missing on lines without a level (Kong, frontends, other plain text) */
  level?: LogLevel;
  message: string;
  /** The app's structured fields (context, correlationId, http, error, ...) */
  fields?: Record<string, unknown>;
  /** The provider's own record */
  raw: unknown;
}

/**
 * What to read. Readers filter on the provider's side where they can; the
 * printer checks every line again, so all providers show the same lines.
 */
export interface LogsQuery {
  sources: LogSource[];
  since: Date;
  until: Date;
  /** This level and above; lines without a level are left out */
  level?: LogLevel;
  kind?: LogKind;
  /** Case-insensitive text anywhere in the line (message and fields) */
  grep?: string;
}

/**
 * The newest entries of a window, for the MCP tool
 */
export interface NewestLogsResult {
  /** Oldest first */
  entries: LogEntry[];
  /** True when the window holds older entries that were left out */
  more: boolean;
  /** Matching entries in the window, when the provider can count them */
  total?: number;
}

/**
 * Last line of each source, for the source list
 */
export interface LogSourceLastLogged {
  source: LogSource;
  /** ISO 8601, UTC; missing when nothing was logged in the window */
  lastLogged?: string;
}

/**
 * What each provider implements for infra:logs
 */
export interface LogsReader {
  /** Each source's last line in the past LOG_SOURCE_LIST_WINDOW_DAYS days */
  lastLogged(sources: LogSource[], now: Date): Promise<LogSourceLastLogged[]>;
  /** Every line of the window, oldest first, handed over page by page */
  read(query: LogsQuery, onPage: (entries: LogEntry[]) => void): Promise<void>;
  /** The newest matching lines of the window (MCP get_logs) */
  readNewest(query: LogsQuery, limit: number): Promise<NewestLogsResult>;
}

/**
 * infra:logs options as the command line gives them
 */
export interface InfraLogsOptions {
  env?: string;
  /** Read every source */
  all?: boolean;
  since?: string;
  until?: string;
  level?: string;
  kind?: string;
  grep?: string;
  json?: boolean;
  /** --no-raw (hidden): leave the provider's record out of --json */
  raw?: boolean;
  /** --newest <n> (hidden, MCP get_logs): only the newest n lines */
  newest?: string;
}
