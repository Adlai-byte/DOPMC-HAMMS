import fs from 'node:fs/promises';
import path from 'node:path';
import {sha} from '../scripts/recovery-core.mjs';
export async function createShellRelease(root,variant='candidate'){
  const files={'/scoped/workspace.css':'security/client/workspace.css','/scoped/workspace.mjs':'security/client/workspace.mjs','/scoped/page-state.mjs':'security/client/page-state.mjs','/scoped/read-cache.mjs':'security/client/read-cache.mjs'};
  const assets=new Map();for(const [url,file]of Object.entries(files))assets.set(url,{body:await fs.readFile(path.join(root,file),'utf8'),type:url.endsWith('.css')?'text/css':'text/javascript'});
  const template=await fs.readFile(path.join(root,'security/client/scoped.html'),'utf8'),id=sha({template,files:[...assets].map(([url,a])=>({url,hash:sha(a.body)})),variant});
  assets.set('/scoped/',{body:template.replace('__RELEASE__',JSON.stringify(id)),type:'text/html; charset=utf-8'});
  const manifest={protocol:8,id,assets:Object.fromEntries([...assets].map(([url,a])=>[url,sha(a.body)]))};
  const worker=`const RELEASE=${JSON.stringify(manifest)},NAME='hamms-phase8-'+RELEASE.id;
self.addEventListener('install',event=>event.waitUntil((async()=>{const staged=await caches.open(NAME);try{for(const [url,hash]of Object.entries(RELEASE.assets)){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Missing shell asset');const data=await r.clone().arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');if(digest!==hash)throw Error('Shell asset hash mismatch');await staged.put(url,r);}}catch(e){await caches.delete(NAME);throw e;}})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_APPROVED_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('hamms-phase8-')&&key!==NAME)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')||!Object.hasOwn(RELEASE.assets,url.pathname))return;event.respondWith((async()=>{const cached=await(await caches.open(NAME)).match(url.pathname);if(cached)return cached;return new Response('Shell unavailable; reconnect to update',{status:503});})());});`;
  return {id,manifest,worker,assets};
}
