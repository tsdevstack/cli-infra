import { describe, it, expect } from '@rstest/core';
import { omitGcpProtoDefaults } from './omit-gcp-proto-defaults';

describe('omitGcpProtoDefaults', () => {
  describe('Standard use cases', () => {
    it('should drop unset fields and keep set ones, at every depth', () => {
      expect(
        omitGcpProtoDefaults({
          insertId: 'abc',
          spanId: '',
          traceSampled: false,
          operation: null,
          resource: {
            type: 'cloud_run_revision',
            labels: { service_name: 'auth' },
          },
          split: { uid: '', index: 0, totalSplits: 0 },
          labels: {},
        }),
      ).toEqual({
        insertId: 'abc',
        resource: {
          type: 'cloud_run_revision',
          labels: { service_name: 'auth' },
        },
      });
    });

    it('should keep true, numbers other than 0 and long numbers as text', () => {
      expect(
        omitGcpProtoDefaults({
          cacheHit: true,
          status: 200,
          responseSize: '0',
        }),
      ).toEqual({ cacheHit: true, status: 200, responseSize: '0' });
    });
  });

  describe('Edge cases', () => {
    it('should return undefined when nothing is set', () => {
      expect(omitGcpProtoDefaults({ a: '', b: { c: false } })).toBeUndefined();
      expect(omitGcpProtoDefaults(null)).toBeUndefined();
    });

    it('should clean arrays and drop empty ones', () => {
      expect(omitGcpProtoDefaults({ a: ['x', '', null], b: [] })).toEqual({
        a: ['x'],
      });
    });

    it('should keep objects that are not plain (a Date, bytes) as they are', () => {
      const date = new Date('2026-11-10T12:00:00Z');
      const bytes = Buffer.from([1, 2]);
      expect(omitGcpProtoDefaults({ date, bytes })).toEqual({ date, bytes });
    });
  });
});
