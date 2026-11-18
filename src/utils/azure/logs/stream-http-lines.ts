/**
 * Read a streaming HTTP response line by line (Azure's Container Apps log
 * streams: one line per log line, the connection kept open with follow=true).
 * Resolves when the server ends the response; rejects on a refused request
 * (with its status) or a dropped connection. The signal ends the request.
 */

export async function streamHttpLines(params: {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  onLine: (line: string) => void;
  /** Called once the server accepted the request */
  onOpen?: () => void;
  /** For tests */
  fetchFn?: typeof fetch;
}): Promise<void> {
  const { url, headers, signal, onLine } = params;
  const fetchFn = params.fetchFn ?? fetch;

  const response = await fetchFn(url, { headers, signal });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw Object.assign(
      new Error(
        `HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
      ),
      { status: response.status },
    );
  }
  params.onOpen?.();
  if (!response.body) {
    return;
  }

  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() !== '') {
        onLine(line);
      }
    }
  }
  pending += decoder.decode();
  if (pending.trim() !== '') {
    onLine(pending);
  }
}
