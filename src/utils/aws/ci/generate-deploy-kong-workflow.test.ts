import { describe, it, expect } from '@rstest/core';
import { generateDeployKongWorkflow } from './generate-deploy-kong-workflow';
import type { CIConfig } from './types';

describe('generateDeployKongWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  it('should return a string', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(typeof result).toBe('string');
  });

  it('should be named Deploy Kong Gateway', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('name: "Deploy Kong Gateway');
  });

  it('should include environment choice', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev', 'prod']));
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should include optional tag input', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('tag:');
    expect(result).toContain('required: false');
  });

  it('should authenticate to AWS via OIDC', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('aws-actions/configure-aws-credentials@v4');
    expect(result).toContain('role-to-assume');
  });

  it('should login to ECR', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('aws-actions/amazon-ecr-login@v2');
  });

  it('should enable containerd', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('containerd-snapshotter');
  });

  it('should build and deploy Kong', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('infra:build-kong');
    expect(result).toContain('infra:deploy-kong');
  });

  it('should use full build (not build:libs)', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('run: npm run build');
    expect(result).not.toContain('build:libs');
  });

  it('should not use GCP-specific services', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
  });

  it('should use npx tsdevstack', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('npx tsdevstack');
    expect(result).not.toContain('node packages/cli-core/dist/cli.js');
    expect(result).not.toContain('npm link');
  });

  it('should include npm run build', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('npm run build');
  });
});
