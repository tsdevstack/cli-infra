import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { selectServiceInteractive } from './select-service-interactive';

// Mock inquirer
rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

// Mock context
const mockLogger = {
  info: rs.fn(),
  newline: rs.fn(),
};
const MockCliError = class extends Error {
  constructor(
    message: string,
    public context: string,
    public hint: string,
  ) {
    super(message);
  }
};
const mockLoadFrameworkConfig = rs.fn();

rs.mock('../../../context', () => ({
  getContext: () => ({
    logger: mockLogger,
    CliError: MockCliError,
    loadFrameworkConfig: mockLoadFrameworkConfig,
  }),
}));

rs.mock('../discovery', () => ({
  discoverDeployedServices: rs.fn(),
}));

import inquirer from 'inquirer';
import { discoverDeployedServices } from '../discovery';

describe('selectServiceInteractive', () => {
  const defaultOptions = {
    projectName: 'test-project',
    projectId: 'test-project-123',
    region: 'us-central1',
    sqlInstanceName: 'test-project-postgres',
    credentials: {
      project_id: 'test-project-123',
      region: 'us-central1',
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: 'test-key',
    },
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockLoadFrameworkConfig.mockReturnValue({ services: [] });
  });

  it('should throw error when no deployed services found', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [],
    });

    await expect(selectServiceInteractive(defaultOptions)).rejects.toThrow(
      'No deployed services found',
    );
  });

  it('should show deployed services for selection', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
        {
          name: 'offers-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });
    rs.mocked(inquirer.prompt).mockResolvedValue({
      selectedService: 'auth-service',
    });

    const result = await selectServiceInteractive(defaultOptions);

    expect(result).toBe('auth-service');
    expect(inquirer.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'select',
        name: 'selectedService',
        message: 'Select service to remove:',
      }),
    ]);
  });

  it('should indicate when service is in config and deployed', async () => {
    mockLoadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service' }],
    });
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });
    rs.mocked(inquirer.prompt).mockResolvedValue({
      selectedService: 'auth-service',
    });

    await selectServiceInteractive(defaultOptions);

    const promptCall = rs.mocked(inquirer.prompt).mock
      .calls[0][0] as unknown as { choices: Array<{ name: string }> }[];
    const choices = promptCall[0].choices;
    expect(choices[0].name).toContain('config + deployed');
  });

  it('should indicate when service is deployed only (not in config)', async () => {
    mockLoadFrameworkConfig.mockReturnValue({ services: [] });
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'orphan-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });
    rs.mocked(inquirer.prompt).mockResolvedValue({
      selectedService: 'orphan-service',
    });

    await selectServiceInteractive(defaultOptions);

    const promptCall = rs.mocked(inquirer.prompt).mock
      .calls[0][0] as unknown as { choices: Array<{ name: string }> }[];
    const choices = promptCall[0].choices;
    expect(choices[0].name).toContain('deployed only - not in config');
  });

  it('should allow manual service name entry', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });
    rs.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ selectedService: '__manual__' })
      .mockResolvedValueOnce({ enteredServiceName: 'custom-service' });

    const result = await selectServiceInteractive(defaultOptions);

    expect(result).toBe('custom-service');
  });

  it('should continue when config loading fails', async () => {
    mockLoadFrameworkConfig.mockImplementation(() => {
      throw new Error('Config not found');
    });
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });
    rs.mocked(inquirer.prompt).mockResolvedValue({
      selectedService: 'auth-service',
    });

    const result = await selectServiceInteractive(defaultOptions);

    expect(result).toBe('auth-service');
  });

  it('should sort services alphabetically', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'zebra-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
        {
          name: 'alpha-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });
    rs.mocked(inquirer.prompt).mockResolvedValue({
      selectedService: 'alpha-service',
    });

    await selectServiceInteractive(defaultOptions);

    const promptCall = rs.mocked(inquirer.prompt).mock
      .calls[0][0] as unknown as { choices: Array<{ value: string }> }[];
    const choices = promptCall[0].choices;
    expect(choices[0].value).toBe('alpha-service');
    expect(choices[1].value).toBe('zebra-service');
  });
});
