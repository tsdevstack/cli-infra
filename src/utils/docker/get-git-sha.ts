/**
 * Get current git SHA
 */

import { execSync } from 'node:child_process';
import { getContext } from '../../context';
import { hasUncommittedSourceChanges } from './has-uncommitted-source-changes';

let warnedAboutUncommittedChanges = false;

/**
 * Get current git commit SHA (short form), used as the image tag when no
 * --tag is given. Warns once per run when there are uncommitted changes:
 * the images then carry the tag of a commit they don't match, and a service
 * already running that tag can keep its old image.
 */
export function getGitSha(): string {
  const sha = execSync('git rev-parse --short HEAD', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  if (!warnedAboutUncommittedChanges && hasUncommittedSourceChanges()) {
    warnedAboutUncommittedChanges = true;
    getContext().logger.warn(
      `Uncommitted changes: images are tagged with the last commit (${sha}), and a service already running that tag can keep its old image. Commit first, or pass --tag.`,
    );
  }

  return sha;
}
