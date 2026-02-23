import { describe, it, expect } from '@rstest/core';
import { generateRemoveDetachedWorkerWorkflow } from './generate-remove-detached-worker-workflow';
import type { CIConfig } from './types';

describe('generateRemoveDetachedWorkerWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  it('should return a string', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(typeof result).toBe('string');
  });

  it('should be named Remove Detached Worker', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('name: "Remove Detached Worker');
  });

  it('should include environment choice', () => {
    const result = generateRemoveDetachedWorkerWorkflow(
      createConfig(['dev', 'prod']),
    );
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should require worker name input', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('worker_name:');
    expect(result).toContain('required: true');
  });

  it('should require confirmation input', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('confirm:');
    expect(result).toContain('Type worker name again to confirm');
  });

  it('should validate confirmation matches worker name', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('Validate confirmation');
  });

  it('should authenticate to AWS via OIDC', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('aws-actions/configure-aws-credentials@v4');
    expect(result).toContain('role-to-assume');
  });

  it('should run remove-detached-worker command', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('infra:remove-detached-worker');
    expect(result).toContain('--confirm');
  });

  it('should include GitHub Step Summary', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('GITHUB_STEP_SUMMARY');
    expect(result).toContain('Worker Removed');
  });

  it('should use build:libs not full build in framework mode', () => {
    const result = generateRemoveDetachedWorkerWorkflow(
      createConfig(['dev']),
      'framework',
    );
    expect(result).toContain('npm run build:libs');
  });

  it('should setup Terraform', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('hashicorp/setup-terraform@v3');
    expect(result).toContain('terraform_version');
  });

  it('should not use GCP-specific services', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
  });

  describe('user mode (default)', () => {
    it('should use npx tsdevstack', () => {
      const result = generateRemoveDetachedWorkerWorkflow(
        createConfig(['dev']),
      );
      expect(result).toContain('npx tsdevstack');
      expect(result).not.toContain('node packages/cli-core/dist/cli.js');
      expect(result).not.toContain('npm link');
    });

    it('should not include build steps', () => {
      const result = generateRemoveDetachedWorkerWorkflow(
        createConfig(['dev']),
      );
      expect(result).not.toContain('build:libs');
    });
  });

  describe('framework mode', () => {
    it('should use node packages/cli-core/dist/cli.js', () => {
      const result = generateRemoveDetachedWorkerWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('node packages/cli-core/dist/cli.js');
      // Note: npx tsdevstack may appear in summary/next-steps text (user-facing instructions)
      // but actual CLI invocations use node packages/cli-core/dist/cli.js
      expect(result).not.toContain('run: npx tsdevstack');
    });

    it('should include npm link', () => {
      const result = generateRemoveDetachedWorkerWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('npm link');
    });

    it('should have Framework workflow name', () => {
      const result = generateRemoveDetachedWorkerWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('name: "Framework: Remove Detached Worker');
    });

    it('should have framework header comment', () => {
      const result = generateRemoveDetachedWorkerWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('Framework development workflow');
    });
  });
});
