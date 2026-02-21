import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { execSync } from 'node:child_process';
import { checkDockerInstalled } from './check-docker-installed';

rs.mock('node:child_process', { mock: true });

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

describe('checkDockerInstalled', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('when Docker is installed', () => {
    it('should return true', () => {
      rs.mocked(execSync).mockReturnValue('Docker version 24.0.0');

      const result = checkDockerInstalled();

      expect(result).toBe(true);
    });

    it('should call docker version command', () => {
      rs.mocked(execSync).mockReturnValue('Docker version 24.0.0');

      checkDockerInstalled();

      expect(execSync).toHaveBeenCalledWith('docker version', {
        stdio: 'pipe',
      });
    });
  });

  describe('when Docker is not installed', () => {
    it('should throw CliError', () => {
      rs.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });

      expect(() => checkDockerInstalled()).toThrow(mockCliError);
    });

    it('should include installation hint in error', () => {
      rs.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });

      try {
        checkDockerInstalled();
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as InstanceType<typeof mockCliError>).hint).toContain(
          'docker.com',
        );
      }
    });

    it('should include context in error', () => {
      rs.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });

      try {
        checkDockerInstalled();
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as InstanceType<typeof mockCliError>).context).toBe(
          'infra:docker',
        );
      }
    });
  });
});
