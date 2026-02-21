import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import { runTerraform } from './run-terraform';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

rs.mock('node:child_process', () => ({
  spawn: rs.fn(),
}));

describe('runTerraform', () => {
  let mockProcess: EventEmitter & {
    stdout: EventEmitter | null;
    stderr: EventEmitter | null;
  };

  beforeEach(() => {
    mockProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter | null;
      stderr: EventEmitter | null;
    };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    rs.mocked(spawn).mockReturnValue(
      mockProcess as unknown as ReturnType<typeof spawn>,
    );
  });

  afterEach(() => {
    rs.clearAllMocks();
  });

  it('should spawn terraform with correct arguments', async () => {
    const promise = runTerraform(['plan', '-refresh-only'], '/path/to/dir', {
      VAR: 'value',
    });

    // Simulate successful exit
    mockProcess.emit('close', 0);

    await promise;

    expect(spawn).toHaveBeenCalledWith('terraform', ['plan', '-refresh-only'], {
      cwd: '/path/to/dir',
      env: { VAR: 'value' },
      stdio: ['inherit', 'pipe', 'pipe'],
    });
  });

  it('should resolve when terraform exits with code 0', async () => {
    const promise = runTerraform(['apply'], '/path', {});

    mockProcess.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('should reject when terraform exits with non-zero code', async () => {
    const promise = runTerraform(['apply'], '/path', {});

    mockProcess.emit('close', 1);

    await expect(promise).rejects.toThrow('Terraform exited with code 1');
  });

  it('should reject on spawn error', async () => {
    const promise = runTerraform(['apply'], '/path', {});

    mockProcess.emit('error', new Error('ENOENT: terraform not found'));

    await expect(promise).rejects.toThrow('ENOENT: terraform not found');
  });

  it('should write stdout to process.stdout', async () => {
    const stdoutSpy = rs
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    const promise = runTerraform(['apply'], '/path', {});

    mockProcess.stdout?.emit('data', Buffer.from('Terraform output'));
    mockProcess.emit('close', 0);

    await promise;

    expect(stdoutSpy).toHaveBeenCalledWith(Buffer.from('Terraform output'));

    stdoutSpy.mockRestore();
  });

  it('should write stderr to process.stderr', async () => {
    const stderrSpy = rs
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const promise = runTerraform(['apply'], '/path', {});

    mockProcess.stderr?.emit('data', Buffer.from('Terraform warning'));
    mockProcess.emit('close', 0);

    await promise;

    expect(stderrSpy).toHaveBeenCalledWith(Buffer.from('Terraform warning'));

    stderrSpy.mockRestore();
  });
});
