/**
 * Run Terraform
 *
 * Execute a terraform command in a specified directory.
 */

import { spawn } from 'node:child_process';

/**
 * Run a terraform command
 *
 * @param args - Terraform command arguments (e.g., ['plan', '-refresh-only'])
 * @param cwd - Working directory to run terraform in
 * @param env - Environment variables to pass to terraform
 * @returns Promise that resolves on success, rejects on failure
 */
export function runTerraform(
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('terraform', args, {
      cwd,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(data);
    });

    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Terraform exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}
