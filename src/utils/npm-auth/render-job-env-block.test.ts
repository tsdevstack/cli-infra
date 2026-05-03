import { describe, it, expect } from '@rstest/core';
import { renderJobEnvBlock } from './render-job-env-block';

describe('renderJobEnvBlock', () => {
  it('returns empty string when npmAuth is false', () => {
    expect(renderJobEnvBlock(false)).toBe('');
  });

  it('emits NPM_TOKEN job-level env block with trailing blank line when npmAuth is true', () => {
    expect(renderJobEnvBlock(true)).toBe(
      '    env:\n      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n\n',
    );
  });

  it('emits indentation that nests under jobs.<job_id>:', () => {
    const out = renderJobEnvBlock(true);
    // 4-space indent for env:, 6-space for the NPM_TOKEN entry
    expect(out).toMatch(/^ {4}env:\n {6}NPM_TOKEN:/);
  });
});
