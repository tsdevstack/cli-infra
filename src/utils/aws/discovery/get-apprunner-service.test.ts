import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { getAppRunnerService } from './get-apprunner-service';

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-apprunner', () => ({
  AppRunnerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListServicesCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'ListServicesCommand', _params: params };
  }),
  DescribeServiceCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'DescribeServiceCommand', _params: params };
  }),
}));

// buildAWSClientConfig uses getContext internally
rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: () => false,
  })),
}));

describe('getAppRunnerService', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    projectName: 'myproject',
    targetEnv: 'dev',
    serviceName: 'frontend',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('successful retrieval', () => {
    it('should return service details when service exists', async () => {
      mockSend
        .mockResolvedValueOnce({
          ServiceSummaryList: [
            {
              ServiceName: 'myproject-dev-frontend',
              ServiceArn:
                'arn:aws:apprunner:us-east-1:123456789012:service/myproject-dev-frontend',
            },
          ],
        })
        .mockResolvedValueOnce({
          Service: {
            ServiceName: 'myproject-dev-frontend',
            ServiceArn:
              'arn:aws:apprunner:us-east-1:123456789012:service/myproject-dev-frontend',
            Status: 'RUNNING',
            ServiceUrl: 'abc123.us-east-1.awsapprunner.com',
            CreatedAt: new Date('2024-01-15'),
            UpdatedAt: new Date('2024-01-20'),
          },
        });

      const result = await getAppRunnerService(baseOptions);
      expect(result.success).toBe(true);
      expect(result.service.exists).toBe(true);
      expect(result.service.serviceName).toBe('frontend');
      expect(result.service.status).toBe('RUNNING');
      expect(result.service.serviceUrl).toBe(
        'abc123.us-east-1.awsapprunner.com',
      );
    });

    it('should return not found when service does not exist', async () => {
      mockSend.mockResolvedValueOnce({
        ServiceSummaryList: [],
      });

      const result = await getAppRunnerService(baseOptions);
      expect(result.success).toBe(true);
      expect(result.service.exists).toBe(false);
      expect(result.service.status).toBe('NOT_FOUND');
    });

    it('should filter by full service name with project prefix', async () => {
      mockSend
        .mockResolvedValueOnce({
          ServiceSummaryList: [
            {
              ServiceName: 'other-project-frontend',
              ServiceArn:
                'arn:aws:apprunner:us-east-1:123456789012:service/other',
            },
            {
              ServiceName: 'myproject-dev-frontend',
              ServiceArn:
                'arn:aws:apprunner:us-east-1:123456789012:service/myproject-dev-frontend',
            },
          ],
        })
        .mockResolvedValueOnce({
          Service: {
            ServiceName: 'myproject-dev-frontend',
            Status: 'RUNNING',
          },
        });

      const result = await getAppRunnerService(baseOptions);
      expect(result.success).toBe(true);
      expect(result.service.exists).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should return error on API failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      const result = await getAppRunnerService(baseOptions);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access Denied');
      expect(result.service.exists).toBe(false);
      expect(result.service.status).toBe('ERROR');
    });
  });
});
