import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
let revision = 'local';
try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) revision += '-dirty';
} catch {}
export default defineConfig({ base: './', define: { __APP_BUILD__: JSON.stringify(`${version}+${revision}`) },
  worker: { format: 'es' }, build: { target: 'es2022' },
  server: { fs: { deny: ['**/output/**', '**/scripts/**', '**/test/**', '**/lib/**', '**/.env*', '**/*.pem'] } }
});
