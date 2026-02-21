import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { printSetupInstructions } from './print-setup-instructions';

describe('printSetupInstructions', () => {
  const createMockLogger = () => ({
    info: rs.fn(),
    newline: rs.fn(),
    warn: rs.fn(),
  });

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should print OIDC setup section', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('AWS OIDC Setup');
    expect(infoCalls).toContain('IAM OIDC Identity Provider');
  });

  it('should print OIDC provider URL', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('token.actions.githubusercontent.com');
    expect(infoCalls).toContain('sts.amazonaws.com');
  });

  it('should print IAM role creation instructions', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('Create IAM Role');
    expect(infoCalls).toContain('Web identity');
    expect(infoCalls).toContain('YOUR_ORG/YOUR_REPO');
  });

  it('should include trust policy JSON example', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('Verify Trust Policy');
    expect(infoCalls).toContain('sts:AssumeRoleWithWebIdentity');
    expect(infoCalls).toContain('StringLike');
    expect(infoCalls).toContain('repo:YOUR_ORG/YOUR_REPO:*');
  });

  it('should reference docs for permissions policy', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('Inline Policy');
    expect(infoCalls).toContain('docs/infra-notes/aws.md');
  });

  it('should include troubleshooting section', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('Troubleshooting');
    expect(infoCalls).toContain('sts:AssumeRoleWithWebIdentity');
    expect(infoCalls).toContain('id-token: write');
  });

  it('should print GitHub secrets for each environment', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev', 'prod'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('AWS_ROLE_ARN_DEV');
    expect(infoCalls).toContain('AWS_REGION_DEV');
    expect(infoCalls).toContain('AWS_ROLE_ARN_PROD');
    expect(infoCalls).toContain('AWS_REGION_PROD');
  });

  describe('user secrets section', () => {
    it('should show message when no user secrets', () => {
      const logger = createMockLogger();
      printSetupInstructions([], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('No user secrets found');
    });

    it('should list user secrets when provided', () => {
      const logger = createMockLogger();
      printSetupInstructions(
        ['API_KEY', 'STRIPE_SECRET'],
        'myproject',
        ['dev'],
        logger,
      );

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('- API_KEY');
      expect(infoCalls).toContain('- STRIPE_SECRET');
    });

    it('should show CLI push commands for each environment', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev', 'prod'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('cloud-secrets:push --env dev');
      expect(infoCalls).toContain('cloud-secrets:push --env prod');
    });

    it('should show manual set command', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('cloud-secrets:set');
    });

    it('should show AWS Console link', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('console.aws.amazon.com/secretsmanager');
    });

    it('should show secret naming pattern', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('myproject-shared-{KEY}');
    });
  });
});
