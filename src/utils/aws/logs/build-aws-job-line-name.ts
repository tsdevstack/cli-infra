/**
 * The name a scheduled job's lines start with in the job function's log
 * group (`job=<name> `): the job's AWS key, from the service it calls and
 * its name. Without a service, the source name itself.
 */

import { buildAwsJobKey } from '../build-aws-job-key';
import type { LogSource } from '../../logs/types';

export function buildAwsJobLineName(source: LogSource): string {
  return source.service
    ? buildAwsJobKey(source.service, source.name)
    : source.name;
}
