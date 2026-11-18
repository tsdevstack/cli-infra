import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = rs.hoisted(() => ({
  request: rs.fn(),
}));

rs.mock('@google-cloud/storage', () => ({
  Storage: class MockStorage {
    authClient = { request: mocks.request };
  },
}));

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    buildGCPClientOptions: () => ({}),
  })),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { resolveGcpNamingScheme } from './resolve-gcp-naming-scheme';

const ctx = {
  projectName: 'myapp',
  targetEnv: 'dev',
  credentials: {
    project_id: 'my-gcp-project',
    region: 'us-central1',
    client_email: 'sa@my-gcp-project.iam.gserviceaccount.com',
    private_key: 'key',
  },
};

function stateWith(content: unknown): void {
  mocks.request.mockResolvedValue({ data: JSON.stringify(content) });
}

/** A gaxios error with the HTTP status */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status, response: { status } });
}

describe('resolveGcpNamingScheme', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should read the environment's state file in the state bucket", async () => {
      stateWith({
        outputs: {},
        resources: [{ type: 'google_compute_network' }],
      });

      await resolveGcpNamingScheme(ctx, 'infra:deploy');

      expect(mocks.request).toHaveBeenCalledWith({
        url: 'https://storage.googleapis.com/storage/v1/b/myapp-tf-state-my-gcp-project/o/dev%2Fdefault.tfstate?alt=media',
        responseType: 'text',
      });
    });

    it('should keep the names of an environment deployed before the scheme', async () => {
      stateWith({
        outputs: {},
        resources: [{ type: 'google_compute_network' }],
      });

      expect(await resolveGcpNamingScheme(ctx, 'infra:deploy')).toBe('legacy');
    });

    it('should give unique names to a new environment (no state file or bucket: 404)', async () => {
      mocks.request.mockRejectedValue(httpError(404, 'No such object'));

      expect(await resolveGcpNamingScheme(ctx, 'infra:deploy')).toBe('unique');
    });

    it('should use the recorded scheme', async () => {
      stateWith({
        outputs: { naming_scheme: { value: 'unique' } },
        resources: [{ type: 'google_compute_network' }],
      });

      expect(await resolveGcpNamingScheme(ctx, 'infra:deploy')).toBe('unique');
    });
  });

  describe('Edge cases', () => {
    it('should stop, not guess, when the state cannot be read', async () => {
      mocks.request.mockRejectedValue(httpError(403, '403 Forbidden'));

      await expect(resolveGcpNamingScheme(ctx, 'infra:deploy')).rejects.toThrow(
        'Could not read the Terraform state gs://myapp-tf-state-my-gcp-project/dev/default.tfstate: 403 Forbidden',
      );
    });

    it('should stop on a state file that is not JSON', async () => {
      mocks.request.mockResolvedValue({ data: '{not json' });

      await expect(resolveGcpNamingScheme(ctx, 'infra:deploy')).rejects.toThrow(
        'is not valid JSON',
      );
    });
  });
});
