import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

rs.mock('../../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

import { getOtlpTracesUrl } from './get-otlp-traces-url';
import { getTerraformOutput } from '../../terraform';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const URL =
  'https://dev-traces.westeurope-1.ingest.monitor.azure.com/datacollectionRules/dcr-1/streams/Microsoft-OTLP-Traces/otlp/v1/traces';

describe('getOtlpTracesUrl', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return the URL from the Terraform outputs', () => {
      rs.mocked(getTerraformOutput).mockReturnValue(URL);

      expect(getOtlpTracesUrl('/tf', { A: 'b' }, 'dev')).toBe(URL);
      expect(getTerraformOutput).toHaveBeenCalledWith(
        '/tf',
        'otlp_traces_url',
        { A: 'b' },
      );
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should warn and return undefined when the output does not exist yet', () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('output not found');
      });

      expect(getOtlpTracesUrl('/tf', {}, 'dev')).toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('infra:deploy --env dev'),
      );
    });

    it('should warn and return undefined when the output is empty', () => {
      rs.mocked(getTerraformOutput).mockReturnValue('');

      expect(getOtlpTracesUrl('/tf', {}, 'dev')).toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalled();
    });
  });
});
