/**
 * Detect whether the project declares private-registry auth via `.npmrc`.
 *
 * Returns `true` if a `.npmrc` exists at the project root. The convention
 * (matching the rest of this codebase and the wider npm ecosystem) is for
 * that file to contain `${NPM_TOKEN}`-style env-var interpolation rather
 * than an actual token, e.g.
 *
 *     //registry.npmjs.org/:_authToken=${NPM_TOKEN}
 *
 * The file is meant to be committed (it has no actual secret — npm
 * interpolates `${NPM_TOKEN}` from the environment at install time), so
 * CI runners see it after `git clone`. Customers whose `.gitignore`
 * blanket-excludes the npmrc pattern should add `!/.npmrc` as an
 * exception so the project-root template is tracked.
 *
 * Presence of the file is the trigger that tells tsdevstack to wire
 * `NPM_TOKEN` through docker builds (BuildKit env-source secret on
 * `npm ci`) and CI workflows (`env: { NPM_TOKEN: ${{ secrets.NPM_TOKEN }} }`).
 * Absence means the project doesn't need private-registry auth and
 * generated artifacts stay free of NPM_TOKEN wiring.
 */
import fs from 'node:fs';
import path from 'node:path';

export function hasProjectNpmrc(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, '.npmrc'));
}
