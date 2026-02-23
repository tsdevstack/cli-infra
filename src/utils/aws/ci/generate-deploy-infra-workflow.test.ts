import { describe, it, expect } from '@rstest/core';
import { generateDeployInfraWorkflow } from './generate-deploy-infra-workflow';
import type { CIConfig } from './types';

describe('generateDeployInfraWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  it('should return a string', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(typeof result).toBe('string');
  });

  it('should be named Deploy Infrastructure', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).toContain('name: "Deploy Infrastructure');
  });

  it('should include environment choice', () => {
    const result = generateDeployInfraWorkflow(
      createConfig(['dev', 'staging', 'prod']),
    );
    expect(result).toContain('- dev');
    expect(result).toContain('- staging');
    expect(result).toContain('- prod');
  });

  it('should authenticate to AWS via OIDC', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).toContain('aws-actions/configure-aws-credentials@v4');
    expect(result).toContain('role-to-assume');
  });

  it('should use build:libs not full build in framework mode', () => {
    const result = generateDeployInfraWorkflow(
      createConfig(['dev']),
      'framework',
    );
    expect(result).toContain('npm run build:libs');
  });

  it('should not include Docker or ECR steps', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).not.toContain('amazon-ecr-login');
    expect(result).not.toContain('containerd');
    expect(result).not.toContain('docker system prune');
  });

  it('should run bootstrap', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).toContain('name: Bootstrap');
    expect(result).toContain('infra:bootstrap');
  });

  it('should push framework secrets', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).toContain('cloud-secrets:push');
    expect(result).toContain('--skip-user-secrets');
  });

  it('should deploy with --infra-only flag', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).toContain('infra:deploy');
    expect(result).toContain('--infra-only');
    expect(result).toContain('--auto-approve');
  });

  it('should not wait for IAM propagation', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).not.toContain('sleep 20');
  });

  it('should not use GCP-specific services', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
  });

  describe('user mode (default)', () => {
    it('should use npx tsdevstack', () => {
      const result = generateDeployInfraWorkflow(createConfig(['dev']));
      expect(result).toContain('npx tsdevstack');
      expect(result).not.toContain('node packages/cli-core/dist/cli.js');
      expect(result).not.toContain('npm link');
    });

    it('should not include build steps', () => {
      const result = generateDeployInfraWorkflow(createConfig(['dev']));
      expect(result).not.toContain('build:libs');
    });
  });

  describe('framework mode', () => {
    it('should use node packages/cli-core/dist/cli.js', () => {
      const result = generateDeployInfraWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('node packages/cli-core/dist/cli.js');
      expect(result).not.toContain('npx tsdevstack');
    });

    it('should include npm link', () => {
      const result = generateDeployInfraWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('npm link');
    });

    it('should have Framework workflow name', () => {
      const result = generateDeployInfraWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('name: "Framework: Deploy Infrastructure');
    });

    it('should have framework header comment', () => {
      const result = generateDeployInfraWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('Framework development workflow');
    });
  });
});
