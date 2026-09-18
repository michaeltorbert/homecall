import {readFileSync} from 'node:fs';
const c=JSON.parse(readFileSync('wrangler.jsonc'));
if(!c.kv_namespaces?.some(b=>b.binding==='STREAM_CATALOG'&&b.id)){
 console.error('Production private catalog is not provisioned. Complete PRIVATE-STREAMS.md rollout gates and configure the production binding first.');process.exit(1);
}
