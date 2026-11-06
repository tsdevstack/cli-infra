/**
 * Build Kong's collector sidecar image for an environment
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { KONG_COLLECTOR_IMAGE_NAME } from '../../constants';
import { buildKongCollectorDockerfile } from './build-kong-collector-dockerfile';

interface KongCollectorImageParams {
  /** Registry URL (the same one as Kong's image) */
  registryUrl: string;
  imageTag: string;
  /** Collector config (buildKongCollectorConfig), baked into the image */
  config: Record<string, unknown>;
}

interface KongCollectorImageTags {
  fullImageTag: string;
  latestTag: string;
}

/**
 * Builds {registry}/kong-collector:{tag} (and :latest) for linux/amd64, like
 * the Kong image. The caller pushes both tags.
 */
export function buildKongCollectorImage(
  params: KongCollectorImageParams,
): KongCollectorImageTags {
  const fullImageTag = `${params.registryUrl}/${KONG_COLLECTOR_IMAGE_NAME}:${params.imageTag}`;
  const latestTag = `${params.registryUrl}/${KONG_COLLECTOR_IMAGE_NAME}:latest`;
  const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kong-collector-'));

  try {
    fs.writeFileSync(
      path.join(contextDir, 'Dockerfile'),
      buildKongCollectorDockerfile(),
    );
    fs.writeFileSync(
      path.join(contextDir, 'config.yaml'),
      yaml.dump(params.config, { lineWidth: -1 }),
    );

    execSync(`docker build --platform linux/amd64 -t ${fullImageTag} .`, {
      cwd: contextDir,
      stdio: 'inherit',
    });
    execSync(`docker tag ${fullImageTag} ${latestTag}`, { stdio: 'pipe' });
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }

  return { fullImageTag, latestTag };
}
