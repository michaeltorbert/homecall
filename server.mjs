import http from 'node:http';
import { metadataGateway, PRODUCTION_ORIGIN, LOCAL_ORIGINS } from './lib/metadata-gateway.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchDukeSchedule } from './lib/duke-source.mjs';
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
let cached;
const server=http.createServer(async(req,res)=>{
  if (req.url.startsWith('/api/homestream/') || req.url.startsWith('/api/sync/')) {
    const request = new Request(new URL(req.url, 'http://127.0.0.1'), { headers: req.headers });
    const response = await metadataGateway(request, { target: req.url, method: req.method, origins: [PRODUCTION_ORIGIN, ...LOCAL_ORIGINS] });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    return;
  }
  if (req.url==='/api/duke') {
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    try {
      if(!cached || Date.now()-cached.time>60000) cached={value:await fetchDukeSchedule(),time:Date.now()};
      res.end(JSON.stringify(cached.value));
    } catch {
      res.statusCode=502;res.end(JSON.stringify({error:'Duke’s broadcast list could not be loaded. Try again shortly.'}));
    }
    return;
  }
  try {
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname!=='/' && pathname!=='/archive.json' && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname)) {res.writeHead(404);res.end('Not found');return;}
    const filename=pathname==='/'?'index.html':pathname.slice(1);
    const content=await readFile(path.join(root,filename));
    res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(content);
  } catch {res.writeHead(404);res.end('Build the app with npm run build before starting it.');}
});
const port = Number(process.env.PORT || 4178);
server.listen(port,'127.0.0.1',()=>console.log(`Homecall: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{server.close();process.exit(0);});
