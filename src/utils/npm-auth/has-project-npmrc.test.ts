import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import fs from 'node:fs';
import { hasProjectNpmrc } from './has-project-npmrc';

describe('hasProjectNpmrc', () => {
  beforeEach(() => {
    rs.restoreAllMocks();
  });

  it('returns true when .npmrc exists at the given project root', () => {
    rs.spyOn(fs, 'existsSync').mockImplementation(
      (p) => String(p) === '/proj/.npmrc',
    );
    expect(hasProjectNpmrc('/proj')).toBe(true);
  });

  it('returns false when .npmrc is absent', () => {
    rs.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(hasProjectNpmrc('/proj')).toBe(false);
  });

  it('does not check any path other than the project root .npmrc', () => {
    const checked: string[] = [];
    rs.spyOn(fs, 'existsSync').mockImplementation((p) => {
      checked.push(String(p));
      return false;
    });
    hasProjectNpmrc('/some/where');
    expect(checked).toEqual(['/some/where/.npmrc']);
  });
});
