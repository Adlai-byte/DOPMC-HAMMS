import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {PROJECT, STORES, EXTRA_PATHS, sha, documentHash, validateBackup, assertPrivateOutput} from './recovery-core.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = assertPrivateOutput(process.argv[2] || path.join(repo,'..','hamms-recovery','backups',new Date().toISOString().replace(/[:.]/g,'-')),repo);
await fs.mkdir(output,{recursive:true});
const req = createRequire(import.meta.url);
let auth;
try { auth = req('firebase-tools/lib/auth.js'); }
catch { auth = req(path.join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib/auth.js')); }
const account = auth.getGlobalDefaultAccount();
if (!account) throw Error('An existing authorized Firebase CLI account is required');
const token = await auth.getAccessToken(account.tokens.refresh_token,[]);
const headers = {Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'};
async function read(url,body) {
  const r=await fetch(url,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json();
  if(!r.ok) throw Error(`Read failed HTTP ${r.status}: ${j.error?.message || url}`);
  return j;
}
// All record queries and metadata reads share one recent snapshot timestamp.
const readTime = new Date(Date.now()-5000).toISOString();
const base=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const documents=[],missingPaths=[];
const storeCounts=Object.fromEntries(STORES.map(s=>[s,0]));
function add(d) {
  const doc={path:d.name.split('/documents/')[1],fields:d.fields||{},sourceCreateTime:d.createTime,sourceUpdateTime:d.updateTime};
  doc.hash=documentHash(doc);documents.push(doc);
}
for(const store of STORES) {
  const rows=await read(`${base}/hammsStores/${store}:runQuery`,{structuredQuery:{from:[{collectionId:'records'}]},readTime});
  const docs=rows.filter(r=>r.document).map(r=>r.document);
  docs.forEach(add);storeCounts[store]=docs.length;
}
const extras=await read(base+':batchGet',{documents:EXTRA_PATHS.map(p=>`projects/${PROJECT}/databases/(default)/documents/${p}`),readTime});
for(const r of extras) { if(r.found)add(r.found);else if(r.missing)missingPaths.push(r.missing.split('/documents/')[1]); }
documents.sort((a,b)=>a.path.localeCompare(b.path));
const backup={format:'hamms-firestore-typed-v1',project:PROJECT,database:'(default)',createdAt:new Date().toISOString(),readTime,scope:'15 HAMMS record collections plus state and legacy document; not Auth accounts or Storage binaries',documents,missingPaths,manifest:{documentCount:documents.length,storeCounts,datasetHash:sha(documents.map(d=>({path:d.path,hash:d.hash})))}};
validateBackup(backup);
// Exclusive creation avoids overwriting a previous recovery point.
await fs.writeFile(path.join(output,'firestore-backup.json'),JSON.stringify(backup,null,2),{flag:'wx',mode:0o600});
const releases={};
for(const [label,origin]of Object.entries({main:'https://demoapp-7864a.web.app',preview:'https://demoapp-7864a--normalized-jagl9vut.web.app'})) {
  releases[label]={origin,files:{}};
  for(const name of ['index.html','sw.js','manifest.json']) {
    const r=await fetch(origin+'/'+name+'?backup='+Date.now());if(!r.ok)throw Error('Hosting snapshot unavailable');
    const text=await r.text();await fs.writeFile(path.join(output,label+'-'+name),text,{flag:'wx',mode:0o600});
    releases[label].files[name]={sha256:sha(text),bytes:Buffer.byteLength(text)};
  }
}
const rulesRelease=await read(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`);
const rules=await read('https://firebaserules.googleapis.com/v1/'+rulesRelease.rulesetName);
await fs.writeFile(path.join(output,'deployed-rules.json'),JSON.stringify(rules,null,2),{flag:'wx',mode:0o600});
const databases=await read(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases`);
const billing=await read(`https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo`);
const r=await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/backupSchedules`,{headers});
const schedules=await r.json();
const inventory={capturedAt:new Date().toISOString(),billingEnabled:billing.billingEnabled,databases:databases.databases?.map(d=>({name:d.name,location:d.locationId,pitr:d.pointInTimeRecoveryEnablement})),backupScheduleReadStatus:r.status,backupSchedules:r.ok?schedules.backupSchedules:undefined,releases};
await fs.writeFile(path.join(output,'environment-inventory.json'),JSON.stringify(inventory,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({output,readTime,documentCount:documents.length,storeCounts,datasetHash:backup.manifest.datasetHash,billingEnabled:inventory.billingEnabled,backupScheduleReadStatus:r.status}));
