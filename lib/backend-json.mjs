// Backend metadata only. Browser JSON/playlist transport keeps its own timeout.
export const BACKEND_TIMEOUT_MS = 8000;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;

// HTTP representation age is not event-reporting latency. Missing or implausible
// headers cannot be replaced by receipt time. Add one second for Date precision.
export function representationAge(headers, startedAt, receivedAt) {
  const date = headers.get('date'), age = headers.get('age');
  if (!date || !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(date)) return null;
  const timestamp = Date.parse(date), delay = receivedAt - startedAt;
  if (![timestamp, startedAt, receivedAt, delay].every(Number.isSafeInteger) || delay < 0 || timestamp > receivedAt + 1000) return null;
  if (age !== null && !/^\d+$/.test(age)) return null;
  const ageMs = age === null ? 0 : Number(age) * 1000;
  const corrected = Math.max(receivedAt - timestamp, ageMs + delay) + 1000;
  return Number.isSafeInteger(corrected) && corrected >= 0 ? corrected : null;
}

export async function readBackendSnapshot(url, { fetcher = fetch, signal, timeoutMs = BACKEND_TIMEOUT_MS, maxBytes = MAX_JSON_BYTES, now = Date.now, diagnostic = () => {} } = {}) {
  const startedAt = now(), deadline = AbortSignal.timeout(timeoutMs);
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let reader, onAbort, stage = 'fetch', status = null, type = 'unknown', bytes = 0;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(boundedSignal.reason);
    boundedSignal.addEventListener('abort', onAbort, { once: true });
    if (boundedSignal.aborted) onAbort();
  });
  try {
    const response = await Promise.race([fetcher(url, {
      signal: boundedSignal, credentials: 'omit', cache: 'no-store', redirect: 'manual',
      headers: { Accept: 'application/json' }
    }), aborted]);
    status = response.status;
    const contentType = response.headers.get('content-type') || '';
    type = /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType) ? 'json' : /^text\/html(?:\s*;|$)/i.test(contentType) ? 'html' : 'other';
    stage = 'headers';
    reader = response.body?.getReader();
    if (!response.ok || response.redirected || !reader || type !== 'json') throw Error('metadata-unavailable');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    stage = 'body';
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw Error('metadata-too-large');
      text += decoder.decode(value, { stream: true });
    }
    boundedSignal.throwIfAborted();
    stage = 'json';
    const data = JSON.parse(text + decoder.decode());
    const receivedAt = now();
    return { data, receivedAt, ageMs: representationAge(response.headers, startedAt, receivedAt) };
  } catch (error) {
    // Deliberately exclude URL, body, raw errors and all request headers.
    const failure = error?.name === 'TimeoutError' ? 'timeout' : boundedSignal.aborted ? 'aborted' : bytes > maxBytes ? 'too-large' : stage === 'json' ? 'invalid-json' : stage === 'fetch' ? 'network-or-runtime' : 'invalid-response';
    try { diagnostic({ stage, status, type, bytes, elapsedMs: Math.max(0, now() - startedAt), failure }); } catch { /* Logging cannot change availability. */ }
    throw error;
  } finally {
    boundedSignal.removeEventListener('abort', onAbort);
    if (reader) void reader.cancel().catch(() => {});
  }
}
export async function readBackendJSON(url, options) {
  return (await readBackendSnapshot(url, options)).data;
}
