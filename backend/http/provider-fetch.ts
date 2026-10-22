// One bounded recovery attempt for explicit transient HTTP failure only.
// No retries on accepted generation, malformed output, auth or quota rejection.
export async function fetchProvider(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(65000),
    ...(init.signal ? [init.signal] : []),
  ]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetcher(input, { ...init, signal });
    if (attempt === 1 || ![502, 503, 504].includes(response.status)) return response;
    await response.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const cancel = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener('abort', cancel);
          resolve();
        },
        500 + Math.floor(Math.random() * 250),
      );
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  throw Error('Provider unavailable.');
}
