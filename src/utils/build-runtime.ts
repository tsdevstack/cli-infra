/**
 * Build InfraCoreRuntime from cli-infra's getContext()
 *
 * Single source of truth for bridging cli-core's plugin context
 * to infra-core's runtime interface. All wrappers use this instead
 * of unsafe `as InfraCoreRuntime` casts.
 */

import fs from 'node:fs';
import type { InfraCoreRuntime } from '@tsdevstack/infra-core';
import { getContext } from '../context';

export function buildRuntime(): InfraCoreRuntime {
  const ctx = getContext();
  return {
    logger: ctx.logger,
    executeCommand: ctx.executeCommand,
    writeFile: ctx.writeTextFile,
    readFile: (p: string) => fs.readFileSync(p, 'utf-8'),
    ensureDirectory: ctx.ensureDirectory,
    cleanupFolder: ctx.cleanupFolder,
    isCIEnv: ctx.isCIEnv,
  };
}
