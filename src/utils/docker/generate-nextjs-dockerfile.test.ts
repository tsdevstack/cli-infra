import { describe, it, expect } from '@rstest/core';
import { generateNextJsDockerfile } from './generate-nextjs-dockerfile';

describe('generateNextJsDockerfile', () => {
  const baseOptions = {
    serviceName: 'frontend',
    workspacePackages: ['packages/bff-client', 'packages/shared-types'],
  };

  describe('deps stage', () => {
    it('should use node:24-slim for deps stage', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('FROM node:24-slim AS deps');
    });

    it('should set workdir to /app', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('WORKDIR /app');
    });

    it('should copy root package files', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('COPY package.json package-lock.json ./');
    });

    it('should copy workspace package.json files', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain(
        'COPY packages/bff-client/package.json ./packages/bff-client/',
      );
      expect(result).toContain(
        'COPY packages/shared-types/package.json ./packages/shared-types/',
      );
    });

    it('should run npm ci with cache mount for deterministic installs', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain(
        'RUN --mount=type=cache,target=/root/.npm npm ci',
      );
    });

    it('does not COPY .npmrc or mount NPM_TOKEN by default', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).not.toContain('.npmrc');
      expect(result).not.toContain('NPM_TOKEN');
      expect(result).not.toContain('id=npm_token');
    });

    it('COPYs .npmrc and emits NPM_TOKEN env-source secret mount when npmAuthEnvSecret is on', () => {
      const result = generateNextJsDockerfile({
        ...baseOptions,
        npmAuthEnvSecret: true,
      });
      expect(result).toContain('COPY package.json package-lock.json .npmrc ./');
      expect(result).toContain(
        'RUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=npm_token,env=NPM_TOKEN npm ci',
      );
    });

    it('does not leak .npmrc or NPM_TOKEN into the production stage', () => {
      const result = generateNextJsDockerfile({
        ...baseOptions,
        npmAuthEnvSecret: true,
      });
      const productionStart = result.indexOf('FROM node:24-slim AS production');
      expect(productionStart).toBeGreaterThan(-1);
      const productionStage = result.slice(productionStart);
      expect(productionStage).not.toContain('.npmrc');
      expect(productionStage).not.toContain('NPM_TOKEN');
    });
  });

  describe('build stage', () => {
    it('should copy all files', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('COPY . .');
    });

    it('should set NODE_ENV to production', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('ENV NODE_ENV=production');
    });

    it('should build the specific service workspace', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('RUN npm run build --workspace=apps/frontend');
    });
  });

  describe('production stage', () => {
    it('should use node:24-slim for smaller runtime', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('FROM node:24-slim AS production');
    });

    it('should install dumb-init for signal handling', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('dumb-init');
    });

    it('should run as node user', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('USER node');
    });

    it('should set PORT to 8080', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('ENV PORT=8080');
    });

    it('should set HOSTNAME to 0.0.0.0', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('ENV HOSTNAME="0.0.0.0"');
    });

    it('should copy standalone server', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/apps/frontend/.next/standalone ./',
      );
    });

    it('should copy static assets', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/apps/frontend/.next/static ./apps/frontend/.next/static',
      );
    });

    it('should copy public folder', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain(
        'COPY --chown=node:node --from=build /app/apps/frontend/public ./apps/frontend/public',
      );
    });

    it('should expose port 8080', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('EXPOSE 8080');
    });

    it('should use dumb-init to run server.js with HOSTNAME override', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain(
        'CMD ["dumb-init", "sh", "-c", "HOSTNAME=0.0.0.0 exec node apps/frontend/server.js"]',
      );
    });
  });

  describe('header comment', () => {
    it('should include service name in comment', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain('# Next.js Dockerfile for frontend');
    });

    it('should include generation command comment', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain(
        '# Generated by: npx tsdevstack infra:generate-docker',
      );
    });

    it('should mention standalone requirement', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toContain(
        '# Requires: output: "standalone" in next.config.ts',
      );
    });
  });

  describe('different service names', () => {
    it('should use correct service name in paths', () => {
      const result = generateNextJsDockerfile({
        ...baseOptions,
        serviceName: 'web-app',
      });
      expect(result).toContain('--workspace=apps/web-app');
      expect(result).toContain('/app/apps/web-app/.next/standalone');
      expect(result).toContain('./apps/web-app/.next/static');
      expect(result).toContain('./apps/web-app/public');
      expect(result).toContain('apps/web-app/server.js');
    });
  });

  describe('snapshot', () => {
    it('should match snapshot', () => {
      const result = generateNextJsDockerfile(baseOptions);
      expect(result).toMatchSnapshot();
    });
  });
});
