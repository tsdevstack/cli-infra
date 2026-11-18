import { describe, it, expect, rs } from '@rstest/core';
import { streamHttpLines } from './stream-http-lines';

/** A response whose body arrives in these chunks */
function respond(chunks: string[], status = 200): typeof fetch {
  return rs.fn(async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(status === 200 ? body : chunks.join(''), { status });
  }) as unknown as typeof fetch;
}

describe('streamHttpLines', () => {
  describe('Standard use cases', () => {
    it('should hand over whole lines across chunks and send the headers', async () => {
      const fetchFn = respond(['{"a":', '1}\n{"b":2}\r\n', '\n{"c":3}']);
      const lines: string[] = [];
      const onOpen = rs.fn();

      await streamHttpLines({
        url: 'https://example.azurecontainerapps.dev/logstream?follow=true',
        headers: { Authorization: 'Bearer t' },
        signal: new AbortController().signal,
        onLine: (line) => lines.push(line),
        onOpen,
        fetchFn,
      });

      expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(rs.mocked(fetchFn).mock.calls[0][1]).toMatchObject({
        headers: { Authorization: 'Bearer t' },
      });
    });
  });

  describe('Edge cases', () => {
    it('should fail on a refused request, with its status', async () => {
      const onOpen = rs.fn();

      await expect(
        streamHttpLines({
          url: 'https://example/logstream',
          headers: {},
          signal: new AbortController().signal,
          onLine: () => undefined,
          onOpen,
          fetchFn: respond(['Forbidden'], 403),
        }),
      ).rejects.toMatchObject({ message: 'HTTP 403: Forbidden', status: 403 });
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('should pass the signal on to the request', async () => {
      const controller = new AbortController();
      const fetchFn = rs.fn(
        async (_url: string, init: { signal: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      ) as unknown as typeof fetch;

      const done = streamHttpLines({
        url: 'https://example/logstream',
        headers: {},
        signal: controller.signal,
        onLine: () => undefined,
        fetchFn,
      });
      controller.abort();

      await expect(done).rejects.toThrow('aborted');
    });
  });
});
