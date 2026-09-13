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
  if (!/^(?:homestream|sync)\/[A-Za-z0-9/-]+$/.test(path)) throw Error('Invalid metadata path');
  return gateway ? new URL(`/api/${path}`, gateway) : new URL(`api/${path}`, baseURI);
}
