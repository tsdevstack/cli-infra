import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import fs from 'node:fs';
import { validateNextjsStandalone } from './validate-nextjs-standalone';

rs.mock('node:fs', { mock: true });

// Mock the context
const mockCliError = class extends Error {
  constructor(
    message: string,
    public context: string,
    public hint: string,
  ) {
    super(message);
  }
};

rs.mock('../../context', () => ({
  getContext: () => ({
    CliError: mockCliError,
  }),
}));

describe('validateNextjsStandalone', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('when config file exists with standalone output', () => {
    it('should not throw for output: "standalone"', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.ts');
      });

      rs.mocked(fs.readFileSync).mockReturnValue(`
        import type { NextConfig } from "next";
        const nextConfig: NextConfig = {
          output: "standalone",
        };
        export default nextConfig;
      `);

      expect(() =>
        validateNextjsStandalone('/project', 'frontend'),
      ).not.toThrow();
    });

    it("should not throw for output: 'standalone' (single quotes)", () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.ts');
      });

      rs.mocked(fs.readFileSync).mockReturnValue(`
        const nextConfig = {
          output: 'standalone',
        };
      `);

      expect(() =>
        validateNextjsStandalone('/project', 'frontend'),
      ).not.toThrow();
    });

    it('should not throw for "output": "standalone" (JSON style)', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.js');
      });

      rs.mocked(fs.readFileSync).mockReturnValue(`
        module.exports = {
          "output": "standalone"
        };
      `);

      expect(() =>
        validateNextjsStandalone('/project', 'frontend'),
      ).not.toThrow();
    });
  });

  describe('when config file exists without standalone output', () => {
    it('should throw CliError when output is not standalone', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.ts');
      });

      rs.mocked(fs.readFileSync).mockReturnValue(`
        const nextConfig = {
          reactStrictMode: true,
        };
      `);

      expect(() => validateNextjsStandalone('/project', 'frontend')).toThrow(
        mockCliError,
      );
    });

    it('should throw CliError when output has different value', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.ts');
      });

      rs.mocked(fs.readFileSync).mockReturnValue(`
        const nextConfig = {
          output: "export",
        };
      `);

      expect(() => validateNextjsStandalone('/project', 'frontend')).toThrow(
        mockCliError,
      );
    });

    it('should include service name in error message', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.ts');
      });

      rs.mocked(fs.readFileSync).mockReturnValue(`const nextConfig = {};`);

      try {
        validateNextjsStandalone('/project', 'my-frontend');
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('my-frontend');
      }
    });
  });

  describe('when config file does not exist', () => {
    it('should throw CliError when no config file found', () => {
      rs.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => validateNextjsStandalone('/project', 'frontend')).toThrow(
        mockCliError,
      );
    });

    it('should include service name in error message', () => {
      rs.mocked(fs.existsSync).mockReturnValue(false);

      try {
        validateNextjsStandalone('/project', 'my-app');
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('my-app');
      }
    });
  });

  describe('config file extensions', () => {
    it('should check next.config.ts first', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.ts');
      });

      rs.mocked(fs.readFileSync).mockReturnValue('output: "standalone"');

      validateNextjsStandalone('/project', 'frontend');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('next.config.ts'),
        'utf-8',
      );
    });

    it('should fall back to next.config.js', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.js');
      });

      rs.mocked(fs.readFileSync).mockReturnValue('output: "standalone"');

      validateNextjsStandalone('/project', 'frontend');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('next.config.js'),
        'utf-8',
      );
    });

    it('should fall back to next.config.mjs', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('next.config.mjs');
      });

      rs.mocked(fs.readFileSync).mockReturnValue('output: "standalone"');

      validateNextjsStandalone('/project', 'frontend');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('next.config.mjs'),
        'utf-8',
      );
    });
  });
});
