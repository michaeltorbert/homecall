// Backend metadata only. Browser JSON/playlist transport keeps its own timeout.
export const BACKEND_TIMEOUT_MS = 8000;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export async function readBackendJSON(url, { fetcher = fetch, signal, timeoutMs = BACKEND_TIMEOUT_MS, maxBytes = MAX_JSON_BYTES } = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let reader, onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(boundedSignal.reason);
    boundedSignal.addEventListener('abort', onAbort, { once: true });
    if (boundedSignal.aborted) onAbort();
  });
  try {
    const response = await Promise.race([fetcher(url, {
      // workerd rejects redirect:'error'; manual plus the !ok check never follows 3xx.
      signal: boundedSignal, credentials: 'omit', cache: 'no-store', redirect: 'manual',
      headers: { Accept: 'application/json' }
    }), aborted]);
    reader = response.body?.getReader();
    if (!response.ok || response.redirected || !reader || !/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw Error('metadata-unavailable');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw Error('metadata-too-large');
      text += decoder.decode(value, { stream: true });
    }
    boundedSignal.throwIfAborted();
    return JSON.parse(text + decoder.decode());
  } finally {
    boundedSignal.removeEventListener('abort', onAbort);
    // Cancellation must not prolong the deadline when an upstream body hangs.
    if (reader) void reader.cancel().catch(() => {});
  }
}
