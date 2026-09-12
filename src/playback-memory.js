// Store positions only, never audio. Storage failure must not prevent listening.
export class PlaybackMemory {
  constructor(storage, onWarning = () => {}, now = Date.now) {
    this.records = new Map(); this.storage = storage; this.onWarning = onWarning; this.now = now;
  }
  read(kind, id) {
    try {
      const key = `homecall.position.${kind}.${id}`;
      let record = this.records.get(key);
      if (!record) record = JSON.parse(this.storage?.getItem(key) || 'null');
      if (record?.version !== 1 || !Number.isFinite(record.value) || record.value < 0 ||
          !Number.isFinite(record.savedAt) ||
          (kind === 'live' && record.value > 180)) return null;
      return record;
    } catch { return null; }
  }
  save(kind, id, value) {
    if (!id || !Number.isFinite(value) || value < 0 || (kind === 'live' && value > 180)) return;
    const key = `homecall.position.${kind}.${id}`, record = { version: 1, value, savedAt: this.now() };
    this.records.set(key, record);
    try {
      if (!this.storage) throw Error('storage unavailable');
      this.storage.setItem(key, JSON.stringify(record));
    } catch { this.onWarning('Playback positions could not be saved on this browser.'); }
  }
}
