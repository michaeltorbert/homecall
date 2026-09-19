// Stateless encrypted resource capabilities. The caller must also verify catalog scope.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const AAD = encoder.encode('homecall-media-v1');
function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid media token');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error('Invalid media token');
  return bytes;
}
export function mediaKeyConfigured(secret) {
  try { return decode(secret).length === 32; } catch { return false; }
}
// One imported key per secret per isolate; a playlist rewrite seals hundreds of capabilities.
const keys = new Map();
async function key(secret) {
  const bytes = decode(secret);
  if (bytes.length !== 32) throw new Error('Invalid media key');
  let imported = keys.get(secret);
  if (!imported) {
    imported = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keys.clear(); keys.set(secret, imported);
  }
  return imported;
}
// Directory capabilities cover one upstream directory; the gateway appends a validated plain filename.
export const RESOURCE_NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,255}$/;
export function isDirectoryTarget(target) { return target?.scope === 'directory'; }
function validate(payload) {
  if (!payload || typeof payload.sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.sourceId) ||
      typeof payload.version !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(payload.version) ||
      !payload.target || typeof payload.target.url !== 'string' || payload.target.url.length > 4096 ||
      !['audio', 'hls', 'resource', 'key'].includes(payload.target.kind) ||
      (payload.target.scope !== undefined && (payload.target.scope !== 'directory' || payload.target.kind !== 'resource' || !payload.target.url.endsWith('/'))) ||
      !Array.isArray(payload.target.allowedOrigins) || payload.target.allowedOrigins.length < 1 || payload.target.allowedOrigins.length > 16 ||
      payload.target.allowedOrigins.some(v => typeof v !== 'string' || v.length > 256) ||
      (payload.target.allowedPaths !== undefined && (!Array.isArray(payload.target.allowedPaths) || payload.target.allowedPaths.length > 16 || payload.target.allowedPaths.some(v => typeof v !== 'string' || v.length > 512)))) throw new Error('Invalid media payload');
}
export async function sealMediaTarget(payload, secret, { now = Date.now(), ttlSeconds = 3600 } = {}) {
  validate(payload);
  if (!Number.isFinite(now) || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400) throw new Error('Invalid media lifetime');
  const plain = encoder.encode(JSON.stringify({ payload, issued: Math.floor(now / 1000), expires: Math.floor(now / 1000) + ttlSeconds }));
  if (plain.length > 12000) throw new Error('Media payload too large');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await key(secret), plain));
  const bytes = new Uint8Array(12 + encrypted.length); bytes.set(iv); bytes.set(encrypted, 12);
  return encode(bytes);
}
export async function openMediaTarget(token, secret, { now = Date.now() } = {}) {
  try {
    if (typeof token !== 'string' || token.length > 16100 || !Number.isFinite(now)) throw new Error();
    const bytes = decode(token);
    if (bytes.length < 29) throw new Error();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: AAD }, await key(secret), bytes.slice(12));
    const { payload, issued, expires } = JSON.parse(decoder.decode(plain));
    const time = Math.floor(now / 1000);
    if (!Number.isInteger(issued) || !Number.isInteger(expires) || issued > time || expires <= time || expires - issued > 86400 || expires <= issued) throw new Error();
    validate(payload);
    return payload;
  } catch { throw new Error('Invalid or expired media token'); }
}
