import { loadEnv } from 'vite';
import { validateGatewayOrigin } from '../src/gateway.js';
export function gatewayConfig(mode = 'production') {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const required = env.REQUIRE_GATEWAY === 'true' || env.REQUIRE_GATEWAY === '1';
  return { origin: validateGatewayOrigin(env.VITE_GATEWAY_ORIGIN ?? '', { required, allowLocal: !required }), allowLocal: !required };
}
