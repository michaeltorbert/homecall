import http from 'node:http';
import { PRODUCTION_ORIGIN, LOCAL_ORIGINS } from './lib/metadata-gateway.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker from './worker/index.mjs';
import { once } from 'node:events';
// HOMECALL_STATIC_ROOT lets local tests serve a fixture build; the default is ./dist.
const root=process.env.HOMECALL_STATIC_ROOT?path.resolve(process.env.HOMECALL_STATIC_ROOT):fileURLToPath(new URL('./dist/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.png':'image/png'};
// Exact static allowlist, served at the root and under the Pages base path /homecall/:
// the index, flat build assets and the five Now Playing artwork PNGs. Nothing else is read.
const ARTWORK=new Set(['homecall','duke','miami','vt','gt'].map(name=>`/now-playing/${name}-512.png`));
const staticFile=pathname=>{
  const match=/^(?:\/homecall)?(\/.*)$/.exec(pathname), local=match?.[1];
  if(local==='/') return 'index.html';
  if(/^\/assets\/(?!\.)[A-Za-z0-9_.-]+$/.test(local)) return local.slice(1);
  if(ARTWORK.has(local)) return local.slice(1);
  return null;
};
const server=http.createServer(async(req,res)=>{
  if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) {
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {res.writeHead(405,{'Allow':'GET, HEAD, OPTIONS'});res.end();return;}
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const request = new Request(new URL(req.url, `http://127.0.0.1:${server.address().port}`), {method:req.method, headers:req.headers, signal:controller.signal});
    const env = {ALLOWED_ORIGINS:JSON.stringify([PRODUCTION_ORIGIN,...LOCAL_ORIGINS]), MEDIA_TOKEN_KEY:process.env.MEDIA_TOKEN_KEY, MEDIA_STREAM_MODE:'bounded',
      STREAM_CATALOG: {get:async()=>readFile(process.env.HOMECALL_CATALOG_FILE || '.private/catalog.json','utf8')}};
    try {
      const response = await worker.fetch(request,env,{waitUntil:p=>p.catch(()=>{})});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body) for await (const chunk of response.body) { if(!res.write(chunk)) await Promise.race([once(res,'drain'),once(res,'close')]); if(res.destroyed) break; }
      res.end();
    } catch {if(!res.headersSent)res.writeHead(502);res.end();}
    return;
  }
  try {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname==='/homecall') {res.writeHead(308,{'Location':'/homecall/'});res.end();return;}
    const filename=staticFile(pathname);
    if(!filename) {res.writeHead(404);res.end('Not found');return;}
    const content=await readFile(path.join(root,filename));
    res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
  } catch {res.writeHead(404);res.end('Build the app with npm run build before starting it.');}
});
const port = Number(process.env.PORT || 4178);
server.listen(port,'127.0.0.1',()=>console.log(`Homecall: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{server.close();process.exit(0);});
