const inFlight = new Map<string, Promise<unknown>>();

/**
 * Runs fn once for concurrent callers with the same key in this server instance: the first caller runs it and the
 * rest wait for the same answer. Used around work that calls the model, so two loads of one page don't pay twice.
 * The key must name everything the answer depends on, including who is asking.
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
