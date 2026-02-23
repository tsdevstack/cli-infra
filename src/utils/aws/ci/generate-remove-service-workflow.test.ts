import { describe, it, expect } from '@rstest/core';
import { generateRemoveServiceWorkflow } from './generate-remove-service-workflow';
import type { CIConfig } from './types';

describe('generateRemoveServiceWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  it('should return a string', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(typeof result).toBe('string');
  });

  it('should be named Remove Service', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('name: "Remove Service');
  });

  it('should include environment choice', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev', 'prod']));
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should require service name input', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('service_name:');
    expect(result).toContain('required: true');
  });

  it('should require confirmation input', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('confirm:');
    expect(result).toContain('Type service name again to confirm');
  });

  it('should have dry run option', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('dry_run:');
    expect(result).toContain('default: false');
  });

  it('should validate confirmation matches service name', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('Validate confirmation');
  });

  it('should authenticate to AWS via OIDC', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('aws-actions/configure-aws-credentials@v4');
    expect(result).toContain('role-to-assume');
  });

  it('should run remove-service command', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('infra:remove-service');
    expect(result).toContain('--confirm');
  });

  it('should include GitHub Step Summary', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('GITHUB_STEP_SUMMARY');
    expect(result).toContain('Service Removed');
  });

  it('should use build:libs not full build in framework mode', () => {
    const result = generateRemoveServiceWorkflow(
      createConfig(['dev']),
      'framework',
    );
    expect(result).toContain('npm run build:libs');
  });

  it('should not use GCP-specific services', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
  });

  describe('user mode (default)', () => {
    it('should use npx tsdevstack', () => {
      const result = generateRemoveServiceWorkflow(createConfig(['dev']));
      expect(result).toContain('npx tsdevstack');
      expect(result).not.toContain('node packages/cli-core/dist/cli.js');
      expect(result).not.toContain('npm link');
    });

    it('should not include build steps', () => {
      const result = generateRemoveServiceWorkflow(createConfig(['dev']));
      expect(result).not.toContain('build:libs');
    });
  });

  describe('framework mode', () => {
    it('should use node packages/cli-core/dist/cli.js', () => {
      const result = generateRemoveServiceWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('node packages/cli-core/dist/cli.js');
      // Note: npx tsdevstack may appear in summary/next-steps text (user-facing instructions)
      // but actual CLI invocations use node packages/cli-core/dist/cli.js
      expect(result).not.toContain('run: npx tsdevstack');
    });

    it('should include npm link', () => {
      const result = generateRemoveServiceWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('npm link');
    });

    it('should have Framework workflow name', () => {
      const result = generateRemoveServiceWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('name: "Framework: Remove Service');
    });

    it('should have framework header comment', () => {
      const result = generateRemoveServiceWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('Framework development workflow');
    });
  });
});
