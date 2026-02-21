/**
 * Run Terraform (Azure)
 *
 * Execute terraform commands with Azure credentials.
 */

import { spawn } from 'node:child_process';

/**
 * Run a terraform command with the given arguments
 */
export async function runTerraform(
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('terraform', args, {
      cwd,
      env,
      stdio: 'pipe',
    });

    let stderr = '';

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Terraform exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}
