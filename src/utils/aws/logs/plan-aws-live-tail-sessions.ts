/**
 * Plan the Live Tail sessions for --follow.
 *
 * - Only log groups that exist: a missing one (a migration that never ran,
 *   the name before the project was in it) would fail the whole session.
 * - Only the Standard log class: Live Tail follows nothing else.
 * - One session per region (the WAF group is in us-east-1), up to
 *   AWS_LIVE_TAIL_MAX_LOG_GROUPS log groups each. AWS bills each session.
 * - A session's filter pattern only when all its reads have the same one;
 *   otherwise lines are picked out as they arrive (parseAwsLiveTailEvent).
 */

import { AWS_LIVE_TAIL_MAX_LOG_GROUPS } from '../../../constants';
import type {
  AwsExistingLogGroup,
  AwsLiveTailSession,
  AwsLogGroupRead,
} from './types';

export function planAwsLiveTailSessions(
  reads: AwsLogGroupRead[],
  /** Keyed by `{region}/{log group name}` */
  existing: Map<string, AwsExistingLogGroup>,
): {
  sessions: AwsLiveTailSession[];
  /** Log groups Live Tail can't follow (not the Standard class) */
  notStandard: string[];
} {
  const notStandard = new Set<string>();
  // Per region: each log group once, with the reads it serves
  const regions = new Map<
    string,
    Map<string, { arn: string; reads: AwsLogGroupRead[] }>
  >();

  for (const read of reads) {
    const group = existing.get(`${read.region}/${read.logGroupName}`);
    if (!group) {
      continue;
    }
    if (group.logGroupClass && group.logGroupClass !== 'STANDARD') {
      notStandard.add(read.logGroupName);
      continue;
    }
    let groups = regions.get(read.region);
    if (!groups) {
      groups = new Map();
      regions.set(read.region, groups);
    }
    const entry = groups.get(read.logGroupName);
    if (entry) {
      entry.reads.push(read);
    } else {
      groups.set(read.logGroupName, { arn: group.arn, reads: [read] });
    }
  }

  const sessions: AwsLiveTailSession[] = [];
  for (const [region, groups] of regions) {
    const names = [...groups.keys()];
    for (let i = 0; i < names.length; i += AWS_LIVE_TAIL_MAX_LOG_GROUPS) {
      const chunk = names.slice(i, i + AWS_LIVE_TAIL_MAX_LOG_GROUPS);
      const sessionReads = chunk.flatMap(
        (name) => groups.get(name)?.reads ?? [],
      );
      const patterns = new Set(sessionReads.map((read) => read.filterPattern));
      const [pattern] = [...patterns];
      sessions.push({
        region,
        logGroups: chunk.map((name) => ({
          name,
          arn: groups.get(name)?.arn ?? '',
        })),
        reads: sessionReads,
        ...(patterns.size === 1 && pattern && { filterPattern: pattern }),
      });
    }
  }

  return { sessions, notStandard: [...notStandard] };
}
