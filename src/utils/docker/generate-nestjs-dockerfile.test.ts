import { describe, it, expect } from '@rstest/core';
import { generateNestJsDockerfile } from './generate-nestjs-dockerfile';

describe('generateNestJsDockerfile', () => {
  const baseOptions = {
    serviceName: 'auth-service',
    workspacePackages: ['packages/nest-common', 'packages/auth-client'],
    hasDatabase: false,
  };

  describe('base stage', () => {
    it('should use node:22-slim as base image', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('FROM node:22-slim AS base');
    });

    it('should set workdir to /app', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('WORKDIR /app');
    });

    it('should install dumb-init for signal handling', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('dumb-init');
    });
  });

  describe('deps stage', () => {
    it('should copy root package files', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('COPY package.json package-lock.json ./');
    });

    it('should copy workspace package.json files', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain(
        'COPY packages/nest-common/package.json ./packages/nest-common/',
      );
      expect(result).toContain(
        'COPY packages/auth-client/package.json ./packages/auth-client/',
      );
    });

    it('should run npm ci with cache mount', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain(
        'RUN --mount=type=cache,target=/root/.npm npm ci',
      );
    });

    it('does not COPY .npmrc or mount NPM_TOKEN by default', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).not.toContain('.npmrc');
      expect(result).not.toContain('NPM_TOKEN');
      expect(result).not.toContain('id=npm_token');
    });

    it('COPYs .npmrc and emits NPM_TOKEN env-source secret mount when npmAuthEnvSecret is on', () => {
      const result = generateNestJsDockerfile({
        ...baseOptions,
        npmAuthEnvSecret: true,
      });
      expect(result).toContain('COPY package.json package-lock.json .npmrc ./');
      expect(result).toContain(
        'RUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=npm_token,env=NPM_TOKEN npm ci',
      );
    });

    it('does not leak .npmrc or NPM_TOKEN into the production stage', () => {
      const result = generateNestJsDockerfile({
        ...baseOptions,
        npmAuthEnvSecret: true,
      });
      const productionStart = result.indexOf('FROM base AS production');
      expect(productionStart).toBeGreaterThan(-1);
      const productionStage = result.slice(productionStart);
      expect(productionStage).not.toContain('.npmrc');
      expect(productionStage).not.toContain('NPM_TOKEN');
    });
  });

  describe('build stage', () => {
    it('should copy all files', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('COPY . .');
    });

    it('should set NODE_ENV to production', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('ENV NODE_ENV=production');
    });

    it('should build workspace dependencies before the app', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain(
        'RUN npm run build --workspace=packages/nest-common',
      );
      expect(result).toContain(
        'RUN npm run build --workspace=packages/auth-client',
      );
      // Verify order: workspace deps come before app build
      const nestCommonIndex = result.indexOf(
        '--workspace=packages/nest-common',
      );
      const appBuildIndex = result.indexOf('--workspace=apps/auth-service');
      expect(nestCommonIndex).toBeLessThan(appBuildIndex);
    });

    it('should build the specific service workspace', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain(
        'RUN npm run build --workspace=apps/auth-service',
      );
    });
  });

  describe('production stage', () => {
    it('should run as node user', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('USER node');
    });

    it('should copy node_modules from build', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/node_modules ./node_modules',
      );
    });

    it('should copy workspace package dist and package.json for symlink resolution', () => {
      const result = generateNestJsDockerfile(baseOptions);
      // Each workspace package needs its dist folder and package.json
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/packages/nest-common/dist ./packages/nest-common/dist',
      );
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/packages/nest-common/package.json ./packages/nest-common/package.json',
      );
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/packages/auth-client/dist ./packages/auth-client/dist',
      );
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/packages/auth-client/package.json ./packages/auth-client/package.json',
      );
    });

    it('should copy dist folder from build', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/apps/auth-service/dist ./dist',
      );
    });

    it('should copy package.json for runtime metadata', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/apps/auth-service/package.json ./package.json',
      );
    });

    it('should expose port 8080', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('EXPOSE 8080');
    });

    it('should use dumb-init to run node', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('CMD ["dumb-init", "node", "dist/main.js"]');
    });
  });

  describe('database support', () => {
    it('should NOT include prisma folder when hasDatabase is false', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).not.toContain('prisma');
    });

    it('should include prisma folder when hasDatabase is true', () => {
      const result = generateNestJsDockerfile({
        ...baseOptions,
        hasDatabase: true,
      });
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/apps/auth-service/prisma ./prisma',
      );
    });

    it('should include prisma.config.js for Prisma v7 migrations when hasDatabase is true', () => {
      const result = generateNestJsDockerfile({
        ...baseOptions,
        hasDatabase: true,
      });
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/apps/auth-service/prisma.config.js ./prisma.config.js',
      );
    });

    it('does not emit a workspace-level node_modules overlay COPY (apps/<service>/node_modules is never created in the build stage by npm ci with the deps-stage layout, so the COPY would always fail on cold builds)', () => {
      const result = generateNestJsDockerfile({
        ...baseOptions,
        hasDatabase: true,
      });
      expect(result).not.toContain('/app/apps/auth-service/node_modules');
    });
  });

  describe('header comment', () => {
    it('should include service name in comment', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain('# NestJS Dockerfile for auth-service');
    });

    it('should include generation command comment', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toContain(
        '# Generated by: npx tsdevstack infra:generate-docker',
      );
    });
  });

  describe('different service names', () => {
    it('should use correct service name in paths', () => {
      const result = generateNestJsDockerfile({
        ...baseOptions,
        serviceName: 'offers-service',
      });
      expect(result).toContain('--workspace=apps/offers-service');
      expect(result).toContain('/app/apps/offers-service/dist');
    });
  });

  describe('snapshot', () => {
    it('should match snapshot for service without database', () => {
      const result = generateNestJsDockerfile(baseOptions);
      expect(result).toMatchSnapshot();
    });

    it('should match snapshot for service with database', () => {
      const result = generateNestJsDockerfile({
        ...baseOptions,
        hasDatabase: true,
      });
      expect(result).toMatchSnapshot();
    });
  });
});
