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

  it('should print WIF setup section', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('WIF Setup');
    expect(infoCalls).toContain('Workload Identity Pool');
    expect(infoCalls).toContain('github-pool');
  });

  it('should print OIDC provider instructions', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('OpenID Connect (OIDC)');
    expect(infoCalls).toContain('token.actions.githubusercontent.com');
  });

  it('should print attribute mapping instructions', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('google.subject = assertion.sub');
    expect(infoCalls).toContain('attribute.repository');
  });

  it('should print GitHub secrets instructions', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('GCP_WORKLOAD_IDENTITY_PROVIDER');
    expect(infoCalls).toContain('GCP_SERVICE_ACCOUNT');
    expect(infoCalls).toContain('GCP_REGION');
  });

  it('should use PROJECT_ID placeholder in service account email', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain(
      'deploy-sa@<PROJECT_ID>.iam.gserviceaccount.com',
    );
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

    it('should show GCP Console link with PROJECT_ID placeholder', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain(
        'console.cloud.google.com/security/secret-manager',
      );
      expect(infoCalls).toContain('project=<PROJECT_ID>');
    });

    it('should show secret naming pattern', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('myproject-shared-{KEY}');
    });
  });
});
