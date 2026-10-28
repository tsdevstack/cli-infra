/**
 * Detect uncommitted changes that can end up in an image
 */

import { execSync } from 'node:child_process';
import { IMAGE_TAG_IGNORED_PATHS } from '../../constants';

/**
 * Whether the checkout has uncommitted changes (tracked or untracked)
 * outside the folders the CLI writes itself. Best effort: a git error
 * counts as no changes.
 *
 * @returns true when there is uncommitted work an image build would include
 */
export function hasUncommittedSourceChanges(): boolean {
  const excludes = IMAGE_TAG_IGNORED_PATHS.map(
    (path) => `':(top,exclude)${path}'`,
  ).join(' ');
  try {
    const status = execSync(`git status --porcelain -- ':/' ${excludes}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}
