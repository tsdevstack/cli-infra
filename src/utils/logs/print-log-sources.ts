/**
 * Print the sources of an environment and when each last logged
 * (infra:logs without a source name)
 */

import { LOG_SOURCE_LIST_WINDOW_DAYS } from '../../constants';
import type { LogSourceLastLogged } from './types';

export function printLogSources(
  results: LogSourceLastLogged[],
  targetEnv: string,
  json: boolean,
  write: (text: string) => void = (text) => process.stdout.write(text),
): void {
  if (json) {
    const lines = results.map((result) =>
      JSON.stringify({
        source: result.source.name,
        type: result.source.type,
        lastLogged: result.lastLogged ?? null,
      }),
    );
    write(`${lines.join('\n')}\n`);
    return;
  }

  const nameWidth = Math.max(...results.map((r) => r.source.name.length));
  const typeWidth = Math.max(...results.map((r) => r.source.type.length));
  const nothing = `nothing in the past ${LOG_SOURCE_LIST_WINDOW_DAYS} days`;

  const rows = results.map((result) => {
    const last = result.lastLogged
      ? result.lastLogged.replace('T', ' ').replace(/\.\d+Z$|Z$/, '')
      : nothing;
    return `  ${result.source.name.padEnd(nameWidth)}  ${result.source.type.padEnd(typeWidth)}  ${last}`;
  });

  write(
    [
      `Log sources in ${targetEnv}, with each one's last line (UTC):`,
      '',
      ...rows,
      '',
      `Read one source:   npx tsdevstack infra:logs <source> --env ${targetEnv}`,
      `Read all sources:  npx tsdevstack infra:logs --all --env ${targetEnv}`,
      '',
    ].join('\n'),
  );
}
