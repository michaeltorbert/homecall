import { readPrivateCatalog, publicLiveCatalog, publicArchiveCatalog, findArchiveTarget, archiveOrigins } from './private-catalog.mjs';
import { privateGames } from './homestream-catalog.mjs';
import { relayMedia, directoryForm } from './media-relay.mjs';
import { openMediaTarget, sealMediaTarget, mediaKeyConfigured, isDirectoryTarget, RESOURCE_NAME } from './media-token.mjs';
const ID = '[A-Za-z0-9_-]{1,100}';
const live = new RegExp(`^/media/live/(${ID})$`), archive = new RegExp(`^/media/archive/(${ID})/(${ID})$`);
const game = /^\/media\/game\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{1,60})$/;
const resource = /^\/media\/resource\/([A-Za-z0-9_-]{1,16100})(?:\/([A-Za-z0-9_.-]{1,255}))?$/;
// A game listener keeps one capability for a whole broadcast; a catalog version change still revokes it.
const GAME_SOURCE = /^game-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[A-Za-z0-9_-]{1,60}$/;
const GAME_TTL_SECONDS = 6 * 3600;
export async function streamGateway(request,env,{origins=[],fetcher=fetch,target=request.url.replace(/^https?:\/\/[^/]+/,''),nativeBody=false}={}) {
  const origin=request.headers.get('Origin');
  const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'});
  const reply=(error,status)=>new Response(request.method==='HEAD'||status===204?null:JSON.stringify({error}),{status,headers:new Headers([...headers,['Content-Type','application/json; charset=utf-8']])});
  if(origin!==null&&!origins.includes(origin)) return reply('Origin not allowed',403);
  if(origin!==null) headers.set('Access-Control-Allow-Origin',origin);
  const isCatalog=['/api/catalog/live','/api/catalog/archive'].includes(target);
  const matchLive=live.exec(target),matchArchive=archive.exec(target),matchGame=game.exec(target),matchResource=resource.exec(target);
  if(!isCatalog&&!matchLive&&!matchArchive&&!matchGame&&!matchResource) return reply('Unknown stream route',404);
  if(request.method==='OPTIONS') {
    const method=request.headers.get('Access-Control-Request-Method');
    const requested=(request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
    if(!origin||!['GET','HEAD'].includes(method)||requested.some(h=>!['range','if-range'].includes(h)))return reply('Preflight not allowed',403);
    headers.set('Access-Control-Allow-Methods','GET, HEAD');headers.set('Access-Control-Allow-Headers','Range, If-Range');
    return reply(null,204);
  }
  if(!['GET','HEAD'].includes(request.method)){headers.set('Allow','GET, HEAD, OPTIONS');return reply('Method not allowed',405);}
  if((matchGame||matchResource)&&!mediaKeyConfigured(env.MEDIA_TOKEN_KEY))return reply('Media configuration unavailable',503);
  try {
    const catalog=await readPrivateCatalog(env),gatewayOrigin=new URL(request.url).origin;
    if(isCatalog){headers.set('Content-Type','application/json');return new Response(request.method==='HEAD'?null:JSON.stringify(target.endsWith('/live')?publicLiveCatalog(catalog,gatewayOrigin):publicArchiveCatalog(catalog,gatewayOrigin)),{headers});}
    let media,sourceId,directory=null;
    if(matchLive){sourceId=matchLive[1];media=Object.hasOwn(catalog.live,sourceId)?catalog.live[sourceId]:null;}
    if(matchArchive){sourceId=`archive-${matchArchive[1]}-${matchArchive[2]}`;media=findArchiveTarget(catalog,matchArchive[1],matchArchive[2]);}
    if(matchGame){sourceId=`game-${matchGame[1]}-${matchGame[2]}`;media=(await privateGames(matchGame[1],{catalog,fetcher,signal:request.signal})).find(g=>g.id===matchGame[2])?.target;}
    if(matchResource){
      let payload;
      // An expired or invalid capability is a deterministic client condition, not a provider fault; players must not retry it.
      try{payload=await openMediaTarget(matchResource[1],env.MEDIA_TOKEN_KEY);}catch{return reply('Media link expired',403);}
      if(payload.version!==catalog.version)return reply('Media link expired',403);
      media=payload.target;sourceId=payload.sourceId;
      const name=matchResource[2];
      if(isDirectoryTarget(media)!==(name!==undefined))return reply('Media link expired',403);
      if(name!==undefined){if(!RESOURCE_NAME.test(name))return reply('Media link expired',403);const {scope,...rest}=media;directory=media.url;media={...rest,url:media.url+name};}
      let policy;
      if(GAME_SOURCE.test(sourceId))policy={allowedOrigins:catalog.discovery?.mediaOrigins||[]};
      else if(Object.hasOwn(catalog.live,sourceId))policy=catalog.live[sourceId];
      else {
        for(const [school,data] of Object.entries(catalog.archive.schools)) {
          const item=data.items.find(item=>`archive-${school}-${item.id}`===sourceId);
          if(item){policy={allowedOrigins:archiveOrigins(catalog,school,item.url)};break;}
        }
      }
      if(!policy||!Array.isArray(media.allowedOrigins)||media.allowedOrigins.some(o=>!policy.allowedOrigins.includes(o)))return reply('Media link expired',403);
      media={...media,allowedOrigins:policy.allowedOrigins,allowedPaths:policy.allowedPaths};
    }
    if(!media)return reply('Stream unavailable',404);
    if(matchGame){
      // Hand HLS players the directory-capability form so live playlists reload at provider size.
      const form=directoryForm(media);
      if(form){
        const token=await sealMediaTarget({target:{url:form.directory,kind:'resource',allowedOrigins:[new URL(form.directory).origin],scope:'directory'},sourceId,version:catalog.version},env.MEDIA_TOKEN_KEY,{ttlSeconds:GAME_TTL_SECONDS});
        headers.set('Content-Type','application/vnd.apple.mpegurl');
        return new Response(request.method==='HEAD'?null:`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=128000\n${gatewayOrigin}/media/resource/${token}/${form.name}\n`,{headers});
      }
    }
    const response=await relayMedia(request,media,{fetcher,secret:env.MEDIA_TOKEN_KEY,sourceId,version:catalog.version,gatewayOrigin,nativeBody,directory,ttlSeconds:GAME_SOURCE.test(sourceId)?GAME_TTL_SECONDS:3600});
    const delivered=new Headers(response.headers);for(const [key,value]of headers)delivered.set(key,value);
    delivered.set('Access-Control-Expose-Headers','Accept-Ranges, Content-Length, Content-Range');
    return new Response(response.body,{status:response.status,headers:delivered});
  }catch{return reply('Stream temporarily unavailable',502);}
}
