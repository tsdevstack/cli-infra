import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockInquirerPrompt = rs.fn();
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirerPrompt(...args),
  },
}));

import { selectDeployableService } from './select-deployable-service';

describe('selectDeployableService', () => {
  beforeEach(() => {
    rs.resetAllMocks();
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs' },
        { name: 'frontend', type: 'nextjs' },
        { name: 'landing', type: 'spa' },
        { name: 'scripts', type: 'scripts' },
        { name: 'queue-worker', type: 'worker' },
      ],
    });
    mockInquirerPrompt.mockResolvedValue({ serviceName: 'auth-service' });
  });

  it('should prompt with deployable services only', async () => {
    await selectDeployableService();

    const promptCall = mockInquirerPrompt.mock.calls[0][0][0];
    const choices = promptCall.choices;

    expect(choices).toEqual([
      { name: 'auth-service (nestjs)', value: 'auth-service' },
      { name: 'frontend (nextjs)', value: 'frontend' },
      { name: 'landing (spa)', value: 'landing' },
    ]);
  });

  it('should exclude scripts and workers', async () => {
    await selectDeployableService();

    const promptCall = mockInquirerPrompt.mock.calls[0][0][0];
    const values = promptCall.choices.map((c: { value: string }) => c.value);

    expect(values).not.toContain('scripts');
    expect(values).not.toContain('queue-worker');
  });

  it('should return selected service name', async () => {
    mockInquirerPrompt.mockResolvedValue({ serviceName: 'frontend' });

    const result = await selectDeployableService();

    expect(result).toBe('frontend');
  });

  it('should throw when no deployable services found', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'scripts', type: 'scripts' },
        { name: 'worker', type: 'worker' },
      ],
    });

    await expect(selectDeployableService()).rejects.toThrow(mocks.CliError);
  });

  it('should show correct prompt message', async () => {
    await selectDeployableService();

    const promptCall = mockInquirerPrompt.mock.calls[0][0][0];

    expect(promptCall.message).toBe('Select service to deploy:');
    expect(promptCall.type).toBe('select');
  });
});
