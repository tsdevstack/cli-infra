import { describe, it, expect, rs, afterEach } from '@rstest/core';
import { listenForInterrupt } from './listen-for-interrupt';

describe('listenForInterrupt', () => {
  afterEach(() => {
    rs.restoreAllMocks();
  });

  describe('Standard use cases', () => {
    it('should call the handler on the first Ctrl+C', () => {
      const onInterrupt = rs.fn();
      const stop = listenForInterrupt(onInterrupt);

      process.emit('SIGINT', 'SIGINT');
      stop();

      expect(onInterrupt).toHaveBeenCalledTimes(1);
    });

    it('should stop listening when asked', () => {
      const before = process.listenerCount('SIGINT');
      const stop = listenForInterrupt(rs.fn());
      expect(process.listenerCount('SIGINT')).toBe(before + 1);

      stop();

      expect(process.listenerCount('SIGINT')).toBe(before);
    });
  });

  describe('Edge cases', () => {
    it('should exit at once on a second Ctrl+C', () => {
      const exit = rs
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      const onInterrupt = rs.fn();
      const stop = listenForInterrupt(onInterrupt);

      process.emit('SIGINT', 'SIGINT');
      process.emit('SIGINT', 'SIGINT');
      stop();

      expect(onInterrupt).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(130);
    });
  });
});
