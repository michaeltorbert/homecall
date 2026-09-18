import http from 'node:http';
import { PRODUCTION_ORIGIN, LOCAL_ORIGINS } from './lib/metadata-gateway.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker from './worker/index.mjs';
import { once } from 'node:events';
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
  if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) {
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {res.writeHead(405,{'Allow':'GET, HEAD, OPTIONS'});res.end();return;}
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const request = new Request(new URL(req.url, `http://127.0.0.1:${server.address().port}`), {method:req.method, headers:req.headers, signal:controller.signal});
    const env = {ALLOWED_ORIGINS:JSON.stringify([PRODUCTION_ORIGIN,...LOCAL_ORIGINS]), MEDIA_TOKEN_KEY:process.env.MEDIA_TOKEN_KEY,
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
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname!=='/' && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname)) {res.writeHead(404);res.end('Not found');return;}
    const filename=pathname==='/'?'index.html':pathname.slice(1);
    const content=await readFile(path.join(root,filename));
    res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(content);
  } catch {res.writeHead(404);res.end('Build the app with npm run build before starting it.');}
});
const port = Number(process.env.PORT || 4178);
server.listen(port,'127.0.0.1',()=>console.log(`Homecall: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{server.close();process.exit(0);});
