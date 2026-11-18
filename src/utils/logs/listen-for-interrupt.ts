/**
 * Ctrl+C for --follow: the first one calls `onInterrupt` (the streams
 * close and the command ends normally), a second one exits at once, in case
 * a stream doesn't close. Returns the function that stops listening.
 */

export function listenForInterrupt(onInterrupt: () => void): () => void {
  let interrupted = false;
  const handler = (): void => {
    if (interrupted) {
      process.exit(130);
      return;
    }
    interrupted = true;
    onInterrupt();
  };
  process.on('SIGINT', handler);
  return () => {
    process.off('SIGINT', handler);
  };
}
