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
    expect(result).toContain('name: Deploy Infrastructure');
  });

  it('should include environment choice', () => {
    const result = generateDeployInfraWorkflow(
      createConfig(['dev', 'staging', 'prod']),
    );
    expect(result).toContain('- dev');
    expect(result).toContain('- staging');
    expect(result).toContain('- prod');
  });

  it('should authenticate to Azure via OIDC', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).toContain('azure/login@v2');
    expect(result).toContain('client-id');
  });

  it('should set ARM environment variables for Terraform OIDC', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).toContain('ARM_USE_OIDC=true');
  });

  it('should use build:libs not full build', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).toContain('npm run build:libs');
  });

  it('should not include Docker steps', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
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

  it('should not use AWS or GCP auth', () => {
    const result = generateDeployInfraWorkflow(createConfig(['dev']));
    expect(result).not.toContain('aws-actions');
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
    expect(result).not.toContain('AWS_ROLE_ARN');
  });
});
