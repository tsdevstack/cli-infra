/**
 * infra:generate-kong without mocked Kong generation: the real cli-core
 * plugin context generates the cloud kong.yml from a temp project for each
 * provider. Only the command setup (config, credentials), the OpenAPI
 * generation subprocess and the logger are replaced.
 */

import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { pluginContext, type KongTemplate } from '@tsdevstack/cli/plugin';
import type { MockContext } from '@tsdevstack/cli/test-utils';

interface PipelineState {
  projectRoot: string;
  provider: 'gcp' | 'aws' | 'azure';
}

const state = globalThis as unknown as {
  kongPipeline: PipelineState;
  contextMocks: MockContext;
};

// getContext runs only when the command runs, after every import resolved
rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...pluginContext,
    logger: state.contextMocks.logger,
    loadFrameworkConfig: () => ({
      project: { name: 'my-app', version: '1.0.0' },
      framework: { template: 'auth' },
      cloud: { provider: state.kongPipeline.provider },
      services: [
        { name: 'auth-service', type: 'nestjs', globalPrefix: 'auth' },
        { name: 'offers-service', type: 'nestjs', globalPrefix: 'offers' },
      ],
    }),
  })),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: rs.fn(() =>
    Promise.resolve({
      projectRoot: state.kongPipeline.projectRoot,
      projectName: 'my-app',
      provider: state.kongPipeline.provider,
      targetEnv: 'dev',
      credentials: {},
      runningInCI: false,
    }),
  ),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(),
}));

import { infraKongGenerate } from './infra-kong-generate';

const AUTH_OPENAPI = {
  openapi: '3.0.0',
  info: { title: 'Auth', version: '1' },
  paths: {
    '/auth/.well-known/jwks.json': { get: {} },
    '/auth/.well-known/openid-configuration': { get: {} },
    '/auth/v1/auth/login': { post: {} },
    '/auth/v1/user/account': { get: { security: [{ bearer: [] }] } },
  },
};

const OFFERS_OPENAPI = {
  openapi: '3.0.0',
  info: { title: 'Offers', version: '1' },
  paths: {
    '/offers/v1/plans': {
      get: { security: [{ bearer: [] }, { 'api-key': [] }] },
    },
    '/offers/v1/plans/{id}': {
      get: { security: [{ bearer: [] }, { 'api-key': [] }] },
    },
    '/offers/v1/user/assign-plan': { post: { security: [{ bearer: [] }] } },
  },
};

function writeService(root: string, name: string, openapi: object): void {
  const dir = path.join(root, 'apps', name);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, scripts: {} }),
  );
  fs.writeFileSync(
    path.join(dir, 'docs', 'openapi.json'),
    JSON.stringify(openapi),
  );
}

describe.each(['gcp', 'aws', 'azure'] as const)(
  'infraKongGenerate pipeline (%s)',
  (provider) => {
    let projectRoot: string;
    let config: KongTemplate;
    let coreWarn: ReturnType<typeof rs.spyOn>;

    beforeEach(async () => {
      coreWarn = rs
        .spyOn(pluginContext.logger, 'warn')
        .mockImplementation(() => undefined);
      projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kong-pipeline-'));
      state.kongPipeline = { projectRoot, provider };
      writeService(projectRoot, 'auth-service', AUTH_OPENAPI);
      writeService(projectRoot, 'offers-service', OFFERS_OPENAPI);
      fs.writeFileSync(
        path.join(projectRoot, 'kong.user.yml'),
        yaml.dump({
          _format_version: '3.0',
          _transform: true,
          services: [],
          plugins: [
            {
              name: 'request-transformer',
              config: {
                remove: { headers: ['X-Kong-Request-Id', 'X-Kong-Trust'] },
                add: { headers: ['X-Kong-Trust:${KONG_TRUST_TOKEN}'] },
              },
            },
            {
              name: 'rate-limiting',
              config: {
                second: 10,
                minute: 100,
                hour: 2000,
                policy: 'redis',
                redis: { host: 'r' },
              },
            },
          ],
          consumers: [
            {
              username: 'old-partner',
              keyauth_credentials: [{ key: '${OLD_PARTNER_KEY}' }],
            },
          ],
        }),
      );

      await infraKongGenerate({ env: 'dev' });

      config = yaml.load(
        fs.readFileSync(
          path.join(projectRoot, 'infrastructure', 'kong', 'dev', 'kong.yml'),
          'utf-8',
        ),
      ) as KongTemplate;
    });

    afterEach(() => {
      coreWarn.mockRestore();
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('should declare tsdevstack-strip-identity as the first global plugin', () => {
      expect(config.plugins![0]).toEqual({
        name: 'tsdevstack-strip-identity',
        config: {},
      });
      expect(
        config.plugins!.filter((p) => p.name === 'tsdevstack-strip-identity'),
      ).toHaveLength(1);
    });

    it('should generate exact regex routes with methods for every OpenAPI service', () => {
      const generated = config.services.filter((s) =>
        /^(auth|offers)-service-(public|jwt|partner)$/.test(s.name),
      );
      expect(generated.map((s) => s.name).sort()).toEqual([
        'auth-service-jwt',
        'auth-service-public',
        'offers-service-jwt',
        'offers-service-partner',
      ]);

      for (const route of generated.flatMap((s) => s.routes)) {
        expect(route.paths).toHaveLength(1);
        expect(route.paths![0]).toMatch(/^~\/.*\$$/);
        expect(route.methods).toContain('OPTIONS');
        expect(route.strip_path).toBe(false);
      }

      const partner = generated.find(
        (s) => s.name === 'offers-service-partner',
      )!;
      expect(partner.routes.map((r) => [r.paths![0], r.methods])).toEqual([
        ['~/api/offers/v1/plans$', ['GET', 'OPTIONS']],
        ['~/api/offers/v1/plans/[^/]+$', ['GET', 'OPTIONS']],
      ]);
    });

    it('should put the per-IP ceiling, the key plugin and the prefix plugin on every partner route', () => {
      const tls =
        provider === 'gcp'
          ? {}
          : { ssl: true, ssl_verify: true, server_name: '${REDIS_HOST}' };
      const redis = {
        host: '${REDIS_HOST}',
        port: '${REDIS_PORT}',
        password: '${REDIS_PASSWORD}',
        database: 0,
        timeout: 2000,
        ...tls,
      };
      const partnerServices = config.services.filter((s) =>
        s.name.endsWith('-partner'),
      );
      expect(partnerServices.map((s) => s.name)).toEqual([
        'offers-service-partner',
      ]);
      const partner = partnerServices[0];
      // Service-scoped plugins apply to every route of the service
      expect(partner.routes).toHaveLength(2);
      expect(
        partner.routes.every((r) => r.paths![0].startsWith('~/api/')),
      ).toBe(true);
      expect(partner.plugins).toEqual([
        {
          name: 'rate-limiting',
          config: {
            minute: 600,
            limit_by: 'ip',
            policy: 'redis',
            hide_client_headers: false,
            redis,
          },
        },
        {
          name: 'tsdevstack-api-key',
          config: {
            key_names: ['x-api-key'],
            redis,
            // From the global rate-limiting; `second` is ignored
            default_limits: { minute: 100, hour: 2000 },
          },
        },
        { name: 'tsdevstack-api-prefix', config: { prefix: '/api' } },
      ]);
    });

    it('should patch the global limiter for TLS like the partner plugins', () => {
      const global = config.plugins!.find((p) => p.name === 'rate-limiting')!;
      const redis = global.config.redis as Record<string, unknown>;
      expect(redis.ssl).toBe(provider === 'gcp' ? undefined : true);
    });

    it('should generate no key-auth and warn about static partner consumers', () => {
      expect(JSON.stringify(config.services)).not.toContain('key-auth');
      // cli-core's own logger (the context's generators log through it)
      expect(coreWarn).toHaveBeenCalledWith(
        expect.stringContaining(
          'consumers with keyauth_credentials (old-partner): static partner keys are no longer supported',
        ),
      );
      expect(coreWarn).toHaveBeenCalledWith(
        expect.stringContaining('sets second'),
      );
    });

    it('should apply the provider transforms to the generated routes', () => {
      const names = config.services.map((s) => s.name);
      expect(names).not.toContain('oidc-discovery');
      expect(names.includes('health-check')).toBe(provider !== 'gcp');

      // Discovery routes stay exact public routes on the auth-service
      const authPublic = config.services.find(
        (s) => s.name === 'auth-service-public',
      )!;
      expect(authPublic.routes.flatMap((r) => r.paths)).toEqual([
        '~/auth/\\.well-known/jwks\\.json$',
        '~/auth/\\.well-known/openid-configuration$',
        '~/auth/v1/auth/login$',
      ]);
    });

    it('should keep service URL placeholders for build-time resolution', () => {
      // AWS resolves them to Cloud Map URLs (http://{service}.{project}.local:8080),
      // GCP and Azure to their service URLs, all from the secret store
      const urls = new Set(
        config.services
          .filter((s) => s.name !== 'health-check')
          .map((s) => s.url),
      );
      expect([...urls].sort()).toEqual([
        '${AUTH_SERVICE_URL}',
        '${OFFERS_SERVICE_URL}',
      ]);
      expect(config.upstreams).toBeUndefined();
    });

    it('should point OIDC discovery at the auth-service URL placeholder', () => {
      const discovery = config.services
        .flatMap((s) => s.plugins ?? [])
        .filter((p) => p.name === 'oidc')
        .map((p) => p.config.discovery);
      expect(discovery.length).toBeGreaterThan(0);
      for (const url of discovery) {
        expect(url).toBe(
          '${AUTH_SERVICE_URL}/auth/.well-known/openid-configuration',
        );
      }
    });

    it('should add no global post-function (no wake-up hook)', () => {
      const globalNames = (config.plugins ?? []).map((p) => p.name);
      expect(globalNames).not.toContain('post-function');
      expect(JSON.stringify(config)).not.toContain('WAKEUP');
      expect(JSON.stringify(config)).not.toContain('ALB_INTERNAL_DNS');
    });

    it('should have no request-transformer or pre-function on services', () => {
      const perService = JSON.stringify(config.services);
      expect(perService).not.toContain('request-transformer');
      expect(perService).not.toContain('pre-function');
    });
  },
);
