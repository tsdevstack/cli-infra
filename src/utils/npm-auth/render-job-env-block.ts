/**
 * Render a job-level GitHub Actions `env:` block exposing `NPM_TOKEN` to
 * every step in a job. Returns the empty string when `npmAuth` is false,
 * so the caller can interpolate it unconditionally:
 *
 *     `jobs:\n  deploy:\n    runs-on: ubuntu-latest\n${renderJobEnvBlock(npmAuth)}    steps:\n…`
 *
 * Job-level env vars cascade to every step; step-level env entries
 * (e.g. `GCP_REGION: …`) on existing steps still take precedence for their
 * own keys, so this is non-invasive — it only adds `NPM_TOKEN` and does
 * not collide with any existing per-step env wiring.
 *
 * Indent matches the existing pattern in the workflow generators
 * (4 spaces — child of `jobs.<job_id>:`).
 */
export function renderJobEnvBlock(npmAuth: boolean): string {
  if (!npmAuth) return '';
  // Trailing blank line so the env block is visually separated from the
  // following `steps:` block when interpolated as `${envBlock}    steps:`.
  return '    env:\n      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n\n';
}
