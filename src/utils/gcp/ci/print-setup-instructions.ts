/**
 * Print CI Setup Instructions
 *
 * Prints instructions for setting up WIF and user secrets required for deployment.
 */

/**
 * Print setup instructions for CI/CD
 *
 * @param userSecrets - List of user secret keys from .secrets.user.json
 * @param projectName - Project name for secret naming
 * @param projectId - GCP project ID for console link
 * @param environments - Target environments
 * @param logger - Logger instance
 */
export function printSetupInstructions(
  userSecrets: string[],
  projectName: string,
  projectId: string,
  environments: string[],
  logger: {
    info: (msg: string) => void;
    newline: () => void;
    warn: (msg: string) => void;
  },
): void {
  logger.newline();
  logger.info('=== WIF Setup (one-time) ===');
  logger.newline();
  logger.info('Set up Workload Identity Federation in GCP Console:');
  logger.newline();

  logger.info('1. Create Workload Identity Pool');
  logger.info('   IAM & Admin → Workload Identity Federation → Create Pool');
  logger.info('   Name: github-pool');
  logger.newline();

  logger.info('2. Add GitHub as Identity Provider');
  logger.info('   Provider type: OpenID Connect (OIDC)');
  logger.info('   Issuer URL: https://token.actions.githubusercontent.com');
  logger.info('   Attribute mapping:');
  logger.info('     google.subject = assertion.sub');
  logger.info('     attribute.repository = assertion.repository');
  logger.newline();

  logger.info('3. Grant Service Account Access');
  logger.info('   IAM & Admin → Service Accounts → Your Deploy SA');
  logger.info('   Add principal with role "Workload Identity User":');
  logger.info(
    `   principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/YOUR_ORG/YOUR_REPO`,
  );
  logger.newline();

  logger.info('4. Set GitHub Repository Secrets');
  logger.info('   GCP_WORKLOAD_IDENTITY_PROVIDER:');
  logger.info(
    '     projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider',
  );
  logger.info('   GCP_SERVICE_ACCOUNT:');
  logger.info(`     deploy-sa@${projectId}.iam.gserviceaccount.com`);
  logger.info('   GCP_REGION:');
  logger.info('     e.g., us-central1');
  logger.newline();

  logger.info('=== User Secrets Setup ===');
  logger.newline();

  if (userSecrets.length === 0) {
    logger.info('No user secrets found in .secrets.user.json');
    logger.newline();
    return;
  }

  logger.info('Set these secrets for each environment before deploying:');
  logger.newline();

  for (const key of userSecrets) {
    logger.info(`  - ${key}`);
  }

  logger.newline();
  logger.info('Options to set secrets:');
  logger.newline();

  logger.info('  1. CLI (if you have credentials configured):');
  for (const env of environments) {
    logger.info(`     npx tsdevstack cloud-secrets:push --env ${env}`);
  }
  logger.newline();

  logger.info('  2. Set one at a time:');
  logger.info('     npx tsdevstack cloud-secrets:set API_URL --env prod');
  logger.newline();

  logger.info('  3. GCP Console (manual):');
  logger.info(
    `     https://console.cloud.google.com/security/secret-manager?project=${projectId}`,
  );
  logger.info(`     Secret naming: ${projectName}-shared-{KEY}`);
  logger.newline();
}
