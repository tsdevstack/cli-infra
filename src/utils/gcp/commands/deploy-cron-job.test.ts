import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockCreateOrUpdate = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  createOrUpdateCloudRunJob: (...args: unknown[]) =>
    mockCreateOrUpdate(...args),
  buildBackendEnvVars: rs.fn(
    (config: { cronJob?: { name: string; timeoutSeconds: number } }) => ({
      NODE_ENV: 'production',
      CRON_JOB_NAME: config.cronJob?.name,
      CRON_JOB_TIMEOUT: String(config.cronJob?.timeoutSeconds),
    }),
  ),
  buildBackendSecrets: rs.fn(
    (project: string, service: string, hasDatabase: boolean) =>
      hasDatabase
        ? [
            {
              envVar: 'DATABASE_URL',
              secretName: `${project}-${service}-DATABASE_URL`,
              version: 'latest',
            },
          ]
        : [],
  ),
  buildGcpCloudRunName: (project: string, name: string, naming: string) =>
    naming === 'unique' ? `${project}-${name}` : name,
  CRON_JOB_COMMAND: ['node', 'dist/cron.js'],
  CRON_JOB_NAME_PREFIX: 'cron-',
  CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS: 60,
  GCP_PROJECT_LABEL: 'tsdevstack-project',
}));
rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({ runtime: true }),
}));

import { gcpDeployCronJob } from './deploy-cron-job';

const params = {
  projectName: 'shop',
  credentials: {
    project_id: 'gcp-shop',
    region: 'europe-west1',
    client_email: 'x@gcp-shop.iam.gserviceaccount.com',
    private_key: 'k',
  },
  naming: 'unique' as const,
  job: {
    name: 'usage-report',
    type: 'cron' as const,
    schedule: '0 3 * * *',
    targetService: 'auth-service',
  },
  service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
  imageUri: 'registry/auth-service:abc',
  vpcNetwork: 'vpc',
  vpcSubnet: 'subnet',
  serviceAccount: 'shop-auth-service@gcp-shop.iam.gserviceaccount.com',
  poolMax: 7,
  logLevel: 'info',
  traceSampleRate: 1,
  cpu: '1',
  memory: '2Gi',
  timeoutSeconds: 600,
};

describe('gcpDeployCronJob', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockCreateOrUpdate.mockResolvedValue(
      'projects/x/jobs/shop-cron-usage-report',
    );
  });

  it("should define the Cloud Run Job with the service's image, account, secrets, the cron command and the platform timeout", async () => {
    const result = await gcpDeployCronJob(params);

    expect(result).toEqual({ jobName: 'shop-cron-usage-report' });
    expect(mockCreateOrUpdate).toHaveBeenCalledWith(
      { runtime: true },
      expect.objectContaining({
        projectId: 'gcp-shop',
        region: 'europe-west1',
        jobName: 'shop-cron-usage-report',
        imageUri: 'registry/auth-service:abc',
        command: ['node', 'dist/cron.js', 'usage-report'],
        vpcNetwork: 'vpc',
        vpcSubnet: 'subnet',
        serviceAccount: params.serviceAccount,
        env: expect.objectContaining({
          CRON_JOB_NAME: 'usage-report',
          CRON_JOB_TIMEOUT: '600',
        }),
        secretEnv: {
          DATABASE_URL: mocks.buildSecretName(
            'shop',
            'auth-service',
            'DATABASE_URL',
          ),
        },
        cpu: '1',
        memory: '2Gi',
        timeoutSeconds: 660,
        labels: {
          'tsdevstack-project': 'shop',
          'tsdevstack-cron-service': 'auth-service',
          'tsdevstack-cron-job': 'usage-report',
        },
      }),
    );
  });

  it('should give a service without a database no secret env, and a legacy environment no project label', async () => {
    await gcpDeployCronJob({
      ...params,
      naming: 'legacy',
      service: { name: 'auth-service', type: 'nestjs' },
    });

    const definition = mockCreateOrUpdate.mock.calls[0][1] as {
      jobName: string;
      secretEnv: Record<string, string>;
      labels: Record<string, string>;
    };
    expect(definition.jobName).toBe('cron-usage-report');
    expect(definition.secretEnv).toEqual({});
    expect(definition.labels).toEqual({
      'tsdevstack-cron-service': 'auth-service',
      'tsdevstack-cron-job': 'usage-report',
    });
  });
});
