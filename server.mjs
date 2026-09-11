import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchDukeSchedule } from './lib/duke-source.mjs';
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
let cached;
const server=http.createServer(async(req,res)=>{
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
server.listen(4178,'127.0.0.1',()=>console.log('Homecall: http://127.0.0.1:4178'));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{server.close();process.exit(0);});
