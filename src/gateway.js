// Pure configuration validation/resolution, shared by build checks and UI tests.
export function validateGatewayOrigin(value = '', { allowLocal = false, required = false } = {}) {
  if (value === '') {
    if (required) throw Error('VITE_GATEWAY_ORIGIN is required for Pages publishing. Deploy and verify the metadata gateway first.');
    return '';
  }
  try {
    if (typeof value !== 'string' || value.trim() !== value) throw Error();
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || value !== url.origin || (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:'))) throw Error();
    return url.origin;
  } catch { throw Error('VITE_GATEWAY_ORIGIN must be a bare HTTPS origin (loopback HTTP is allowed only for local development).'); }
}
export function metadataURL(path, baseURI, origin = '', options = {}) {
  const gateway = validateGatewayOrigin(origin, options);
  if (!/^(?:homestream|sync|catalog)\/[A-Za-z0-9/-]+$/.test(path)) throw Error('Invalid metadata path');
  return gateway ? new URL(`/api/${path}`, gateway) : new URL(`api/${path}`, baseURI);
}

export const configuredGatewayOrigin = () => typeof __GATEWAY_ORIGIN__ === 'string' ? __GATEWAY_ORIGIN__ : '';
export const gatewayOptions = () => ({ allowLocal: typeof __GATEWAY_ALLOW_LOCAL__ === 'boolean' && __GATEWAY_ALLOW_LOCAL__ });
const mediaPath = /^\/media\/(?:live\/[A-Za-z0-9_-]+|archive\/(?:duke|vt|miami)\/[A-Za-z0-9_-]+|game\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)$/;
export function relayURL(path, origin = configuredGatewayOrigin(), options = gatewayOptions()) {
  const gateway = validateGatewayOrigin(origin, { ...options, required: true });
  if (!mediaPath.test(path)) throw Error('Invalid media path');
  return new URL(path, gateway).href;
}
export function mediaURL(value, { origin = configuredGatewayOrigin(), allowLocal = gatewayOptions().allowLocal, path } = {}) {
  try {
    if (typeof value !== 'string') return null;
    const url = new URL(value);
    const expected = relayURL(path || url.pathname, origin, { allowLocal });
    return value === expected ? expected : null;
  } catch { return null; }
}
