/**
 * Tests for get-total-service-max-instances utility
 */

import { describe, it, expect, rs } from '@rstest/core';
import { getTotalServiceMaxInstances } from './get-total-service-max-instances';

rs.mock('../infrastructure/get-service-config', () => ({
  getServiceConfig: (_config: unknown, serviceName: string) => ({
    maxInstances: serviceName === 'auth-service' ? 5 : 3,
    minInstances: 1,
    cpu: '1',
    memory: '512Mi',
    timeout: 300,
    port: 3000,
    concurrency: 80,
  }),
}));

describe('getTotalServiceMaxInstances', () => {
  const services = [
    { name: 'auth-service', type: 'nestjs', hasDatabase: true },
    { name: 'offers-service', type: 'nestjs', hasDatabase: true },
    { name: 'bff-service', type: 'nestjs', hasDatabase: false },
    { name: 'frontend', type: 'nextjs', hasDatabase: false },
    { name: 'react-app', type: 'spa', hasDatabase: false },
    { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
  ];

  it('should sum maxInstances for services with hasDatabase true', () => {
    // auth-service (5) + offers-service (3) = 8
    const result = getTotalServiceMaxInstances(services, null, 'dev', 'gcp');
    expect(result).toBe(8);
  });

  it('should exclude nestjs services without database', () => {
    // bff-service has hasDatabase: false — not counted
    const result = getTotalServiceMaxInstances(services, null, 'dev', 'gcp');
    expect(result).toBe(8);
  });

  it('should exclude workers', () => {
    // auth-worker is pool-relevant but counted by getTotalWorkerMaxInstances
    const result = getTotalServiceMaxInstances(services, null, 'dev', 'gcp');
    expect(result).toBe(8);
  });

  it('should exclude SPAs and frontends without database', () => {
    const result = getTotalServiceMaxInstances(services, null, 'dev', 'gcp');
    expect(result).toBe(8);
  });

  it('should return 0 when no services have database', () => {
    const noDbServices = [
      { name: 'bff-service', type: 'nestjs', hasDatabase: false },
      { name: 'frontend', type: 'nextjs', hasDatabase: false },
    ];
    const result = getTotalServiceMaxInstances(
      noDbServices,
      null,
      'dev',
      'gcp',
    );
    expect(result).toBe(0);
  });
});
