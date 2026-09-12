export const PREFIX = 'mystream.session.';
export const REASONS = ['unspecified', 'initial', 'commercial', 'drift', 'interruption'];
export const PROVIDERS = ['unspecified', 'youtube-tv', 'cable', 'antenna', 'other'];
export const OUTPUTS = ['unspecified', 'phone', 'wired', 'bluetooth', 'other'];
const ACTIONS = ['pause', 'restore', 'nudge', 'delay', 'live', 'hold', 'complete', 'cancel', 'confirm'];
const EVENTS = ['start', 'end', 'request', 'ack', 'command-failed', 'confirmed', 'episode-abandoned', 'heartbeat', 'observation-gap', 'source-playing', 'source-waiting', 'source-stalled', 'source-ended', 'source-paused', 'source-error', 'context-restored', 'context-interrupted', 'control-overflow', 'resume-failed', 'engine-error', 'command-timeout', 'buffer-overrun', 'hidden', 'visible'];
const cleanState = (state) => {
  const value = {};
  for (const key of ['restoring', 'delay', 'available', 'receivedSeconds', 'renderedSeconds', 'contextSeconds'])
    if (Number.isFinite(state?.[key])) value[key] = state[key];
  for (const key of ['paused', 'holding', 'ingesting']) if (typeof state?.[key] === 'boolean') value[key] = state[key];
  return value;
};
export class SessionLog {
  constructor({ storage, now = () => performance.now(), utc = () => new Date().toISOString(), id = () => crypto.randomUUID(), maxEvents = 2000, maxSessions = 10, build = 'development', onWarning = () => {} } = {}) {
    this.storage = storage; this.now = now; this.utc = utc; this.id = id;
    this.maxEvents = maxEvents; this.maxSessions = maxSessions; this.build = build;
    this.onWarning = onWarning; this.memory = new Map(); this.sequence = 0;
  }
  start(team, sourceId, mode = 'live', provider = 'unspecified', output = 'unspecified') {
    if (this.session) this.end();
    this.origin = this.now(); this.sequence = 0; this.episode = null; this.confirmed = false; this.observation = null;
    this.session = { schemaVersion: 1, app: 'Homecall', build: this.build,
      id: this.id(), team: ['duke', 'miami', 'vt'].includes(team) ? team : 'unknown',
      sourceId: ['duke-leanstream', 'miami-wqam', 'vt-leanstream', 'test-tone'].includes(sourceId) ? sourceId : 'unknown',
      mode: mode === 'demo' ? 'demo' : 'live', provider: PROVIDERS.includes(provider) ? provider : 'unspecified',
      output: OUTPUTS.includes(output) ? output : 'unspecified', startedAt: this.utc(), endedAt: null,
      truncatedEvents: 0, userConfirmedObservedSeconds: 0, observedPlaybackSeconds: 0, confirmedEpisodes: 0, events: [] };
    this.add('start'); return this.session.id;
  }
  add(type, details = {}, state) {
    if (!this.session || !EVENTS.includes(type)) return;
    const event = { sequence: ++this.sequence, type, utc: this.utc(), elapsedMs: Math.max(0, this.now() - this.origin) };
    // Export data is constructed from an allowlist, never serialized from browser errors or source objects.
    for (const key of ['commandId', 'epoch', 'episodeId']) if (Number.isFinite(details[key])) event[key] = details[key];
    if (Number.isFinite(details.requestedValue) || typeof details.requestedValue === 'boolean') event.requestedValue = details.requestedValue;
    for (const key of ['action']) if (ACTIONS.includes(details[key])) event[key] = details[key];
    if (REASONS.includes(details.reason)) event.reason = details.reason;
    if (['applied', 'restoring', 'holding', 'unavailable', 'unknown'].includes(details.result)) event.result = details.result;
    if (details.before) event.before = cleanState(details.before);
    if (details.after) event.after = cleanState(details.after);
    if (state) event.state = cleanState(state);
    this.session.events.push(event);
    if (this.session.events.length > this.maxEvents) {
      this.session.events.shift(); this.session.truncatedEvents++;
      if (this.session.truncatedEvents === 1) this.onWarning('This log reached its limit. The oldest events are being removed; the export records this.');
    }
    this.save();
  }
  request(action, value, commandId, epoch, reason, state) {
    if (['restore', 'nudge', 'delay', 'live', 'hold'].includes(action)) {
      if (!this.episode) this.episode = { id: this.sequence + 1, wasConfirmed: this.confirmed };
      this.confirmed = false;
    }
    if (action === 'pause') this.confirmed = false;
    this.observation = null;
    this.add('request', { action, requestedValue: value, commandId, epoch, reason, episodeId: this.episode?.id }, state);
  }
  acknowledge(action, ack) {
    this.add('ack', { action, commandId: ack.id, epoch: ack.epoch, result: ack.result,
      before: ack.before, after: { ...ack.after, contextSeconds: ack.contextSeconds }, episodeId: this.episode?.id });
  }
  confirm(state, reason) {
    if (!state || state.paused || state.holding || !state.ingesting) return false;
    if (this.episode) this.session.confirmedEpisodes++;
    this.add('confirmed', { reason, episodeId: this.episode?.id }, state);
    this.episode = null; this.confirmed = true;
    this.observation = { time: this.now(), rendered: state.renderedSeconds }; return true;
  }
  boundary(type, state) {
    if (this.episode) this.add('episode-abandoned', { episodeId: this.episode.id }, state);
    this.episode = null; this.confirmed = false; this.observation = null;
    this.add(type, {}, state);
  }
  heartbeat(state, visible = true) {
    const current = this.now(), previous = this.observation;
    const elapsed = previous ? (current - previous.time) / 1000 : 0;
    const rendered = previous ? state?.renderedSeconds - previous.rendered : 0;
    if (!visible || (previous && (elapsed > 45 || elapsed < 0 || rendered < 0))) {
      this.boundary('observation-gap', state);
    } else if (previous && Number.isFinite(rendered) && rendered >= 0) {
      const observed = Math.min(elapsed, rendered);
      this.session.observedPlaybackSeconds += observed;
      if (this.confirmed) this.session.userConfirmedObservedSeconds += observed;
    }
    this.observation = visible && Number.isFinite(state?.renderedSeconds) ? { time: current, rendered: state.renderedSeconds } : null;
    this.add('heartbeat', {}, state);
  }
  end(state) {
    if (!this.session) return;
    this.boundary('end', state); this.session.endedAt = this.utc(); this.save(); this.session = null;
  }
  save() {
    if (!this.session) return;
    const text = JSON.stringify(this.session); this.memory.set(this.session.id, text);
    while (this.memory.size > this.maxSessions) this.memory.delete(this.memory.keys().next().value);
    if (!this.storage) { this.warnMemory(); return; }
    try {
      this.storage.setItem(PREFIX + this.session.id, text);
      const records = this.list();
      for (const old of records.slice(this.maxSessions)) { this.storage.removeItem(PREFIX + old.id); this.memory.delete(old.id); }
      if (records.length > this.maxSessions && !this.retentionWarned) {
        this.retentionWarned = true; this.onWarning(`Only the ${this.maxSessions} most recent logs are kept. Export any you want to save.`);
      }
    } catch { this.warnMemory(); }
    while (this.memory.size > this.maxSessions) this.memory.delete(this.memory.keys().next().value);
  }
  warnMemory() {
    if (!this.memoryOnly) { this.memoryOnly = true; this.onWarning('Log storage is unavailable. Keep this page open and share or download the log before leaving.'); }
  }
  list() {
    const records = new Map(this.memory);
    try {
      for (let i = 0; i < this.storage?.length; i++) {
        const key = this.storage.key(i);
        if (key?.startsWith(PREFIX)) records.set(key.slice(PREFIX.length), this.storage.getItem(key));
      }
    } catch { /* Memory export still works. */ }
    // In-memory state wins when a storage write failed.
    for (const [id, value] of this.memory) records.set(id, value);
    return [...records.values()].flatMap(value => {
      try { const item = JSON.parse(value); return item && item.schemaVersion === 1 && typeof item.id === 'string' && typeof item.startedAt === 'string' && Number.isFinite(Date.parse(item.startedAt)) && Array.isArray(item.events) ? [item] : []; }
      catch { return []; }
    }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  export(id) {
    const s = this.list().find(item => item.id === id); if (!s) return null;
    return JSON.stringify({ ...s, exportedAt: this.utc(),
      status: s.endedAt ? 'ended' : s.id === this.session?.id ? 'active-snapshot' : 'last-saved-unclosed',
      interpretation: 'Adjustments and user confirmation are observations, not measurements of TV latency or proof of continued alignment. Unclosed sessions may have ended through reload or interruption. Playback seconds count observed engine progress, not proof that sound was heard.' }, null, 2);
  }
  clear() {
    if (this.session) return false;
    try {
      const keys = [];
      for (let i = 0; i < this.storage?.length; i++) { const key = this.storage.key(i); if (key?.startsWith(PREFIX)) keys.push(key); }
      for (const key of keys) this.storage.removeItem(key);
    } catch { this.warnMemory(); return false; }
    this.memory.clear(); return true;
  }
}
