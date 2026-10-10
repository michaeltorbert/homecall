// One listening intent: the page-only Source mode, the candidate order frozen at Play, the candidates
// already entered and the physical-attempt token that guards every async continuation. Pure state;
// no audio, timers or DOM. Same-source physical retries are not candidate entries.
export const FAILURE_KINDS = ['permission', 'transport', 'availability', 'environment', 'local'];
// Permission and local failures keep the same candidate; transport and availability may advance.
export function failureKind(error) {
  if (FAILURE_KINDS.includes(error?.kind)) return error.kind;
  if (error?.name === 'NotAllowedError') return 'permission';
  if (error?.message === 'unsupported') return 'environment';
  if (error?.message === 'hls-unsupported') return 'availability';
  return 'transport';
}
export function createListenSession() {
  let mode = 'auto', intent = null, intents = 0, attempts = 0;
  const candidate = () => (intent ? intent.candidates[intent.index] : null);
  return {
    // 'auto' or a chosen sourceId. Never persisted; Play never changes it.
    get mode() { return mode; },
    get intent() { return intent; },
    get candidate() { return candidate(); },
    get pending() { return intent?.pending ?? null; },
    setMode(next = 'auto') { mode = next; intent = null; },
    // Automatic starts at the top; a manual mode starts at its chosen source, so fallback only moves down.
    begin(candidates) {
      const list = [...candidates], index = mode === 'auto' ? 0 : list.findIndex(c => c.sourceId === mode);
      intent = index < 0 || !list.length ? null
        : { id: ++intents, mode, candidates: list, index, firstIndex: index, entered: new Set(), trace: [], pending: null, attempt: 0, noticed: new Set() };
      return intent;
    },
    // A new physical attempt on the current candidate; the candidate is recorded as entered only once.
    attempt() {
      const current = candidate();
      if (!current) return null;
      if (!intent.entered.has(current.sourceId)) { intent.entered.add(current.sourceId); intent.trace.push(current.sourceId); }
      intent.pending = null; intent.attempt = ++attempts;
      return { intentId: intent.id, attemptId: intent.attempt, candidate: current };
    },
    current(token) { return !!intent && token?.intentId === intent.id && token.attemptId === intent.attempt; },
    // The next lower-ranked candidate not yet entered, or null when the intent is exhausted (and ended).
    advance() {
      if (!intent) return null;
      for (let i = intent.index + 1; i < intent.candidates.length; i++) {
        if (intent.entered.has(intent.candidates[i].sourceId)) continue;
        Object.assign(intent, { index: i, pending: null, attempt: 0 });
        return intent.candidates[i];
      }
      intent = null; return null;
    },
    // Denied, paused or local-engine stop: keep this candidate until Play; stale attempt callbacks go inert.
    hold(reason) { if (intent) Object.assign(intent, { pending: reason, attempt: 0 }); },
    // True once per replacement candidate, when its first eligible output arrives.
    outputReady(token) {
      if (!this.current(token) || intent.index === intent.firstIndex) return false;
      const id = candidate().sourceId;
      if (intent.noticed.has(id)) return false;
      intent.noticed.add(id); return true;
    },
    cancel() { intent = null; },
  };
}
