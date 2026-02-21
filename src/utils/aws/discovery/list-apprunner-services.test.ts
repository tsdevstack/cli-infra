import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { listAppRunnerServices } from './list-apprunner-services';

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-apprunner', () => ({
  AppRunnerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListServicesCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'ListServicesCommand', _params: params };
  }),
}));

rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: () => false,
  })),
}));

describe('listAppRunnerServices', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    projectName: 'myproject',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('successful listing', () => {
    it('should return empty array when no services exist', async () => {
      mockSend.mockResolvedValueOnce({
        ServiceSummaryList: [],
      });

      const result = await listAppRunnerServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toEqual([]);
    });

    it('should filter to project services only', async () => {
      mockSend.mockResolvedValueOnce({
        ServiceSummaryList: [
          {
            ServiceName: 'myproject-frontend',
            Status: 'RUNNING',
            ServiceUrl: 'abc123.us-east-1.awsapprunner.com',
          },
          {
            ServiceName: 'other-project-app',
            Status: 'RUNNING',
            ServiceUrl: 'xyz789.us-east-1.awsapprunner.com',
          },
        ],
      });

      const result = await listAppRunnerServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(1);
      expect(result.services[0].name).toBe('myproject-frontend');
    });

    it('should extract service name from full name', async () => {
      mockSend.mockResolvedValueOnce({
        ServiceSummaryList: [
          {
            ServiceName: 'myproject-frontend',
            Status: 'RUNNING',
            ServiceUrl: 'abc123.us-east-1.awsapprunner.com',
          },
        ],
      });

      const result = await listAppRunnerServices(baseOptions);
      expect(result.services[0]).toEqual({
        name: 'myproject-frontend',
        serviceName: 'frontend',
        status: 'RUNNING',
        serviceUrl: 'abc123.us-east-1.awsapprunner.com',
      });
    });

    it('should handle multiple services', async () => {
      mockSend.mockResolvedValueOnce({
        ServiceSummaryList: [
          { ServiceName: 'myproject-frontend', Status: 'RUNNING' },
          { ServiceName: 'myproject-admin', Status: 'RUNNING' },
        ],
      });

      const result = await listAppRunnerServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should return error on API failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      const result = await listAppRunnerServices(baseOptions);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access Denied');
      expect(result.services).toEqual([]);
    });

    it('should handle undefined ServiceSummaryList', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await listAppRunnerServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toEqual([]);
    });
  });
});
