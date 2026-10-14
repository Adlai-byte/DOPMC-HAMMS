import fs from 'node:fs/promises';
import path from 'node:path';
import {DRILL_PROJECT, STORES, EXTRA_PATHS, emulatorBase, documentHash, validateBackup} from './recovery-core.mjs';

const input=process.argv[2] || process.env.HAMMS_RECOVERY_BACKUP;
if(!input) throw Error('Provide the private backup path or HAMMS_RECOVERY_BACKUP');
const base=emulatorBase(process.env.FIRESTORE_EMULATOR_HOST,DRILL_PROJECT);
const backup=JSON.parse(await fs.readFile(input,'utf8'));validateBackup(backup);
const started=Date.now();
async function request(url,body) {
  const r=await fetch(url,{redirect:'error',method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json();if(!r.ok)throw Error(`Emulator request failed HTTP ${r.status}`);return j;
}
async function snapshot() {
  const docs=[];
  for(const store of STORES) {
    const rows=await request(`${base}/hammsStores/${store}:runQuery`,{structuredQuery:{from:[{collectionId:'records'}]}});
    docs.push(...rows.filter(r=>r.document).map(r=>({path:r.document.name.split('/documents/')[1],fields:r.document.fields||{}})));
  }
  const extra=await request(base+':batchGet',{documents:EXTRA_PATHS.map(p=>`projects/${DRILL_PROJECT}/databases/(default)/documents/${p}`)});
  docs.push(...extra.filter(r=>r.found).map(r=>({path:r.found.name.split('/documents/')[1],fields:r.found.fields||{}})));
  return docs;
}
if((await snapshot()).length) throw Error('Recovery emulator must be empty; refusing to overwrite existing data');
for(let i=0;i<backup.documents.length;i+=100) {
  const writes=backup.documents.slice(i,i+100).map(d=>({update:{name:base.replace(/^http:\/\/[^/]+\/v1\//,'')+'/'+d.path,fields:d.fields},currentDocument:{exists:false}}));
  await request(base+':commit',{writes});
}
const restored=await snapshot();const expected=new Map(backup.documents.map(d=>[d.path,d.hash]));
const mismatches=restored.filter(d=>expected.get(d.path)!==documentHash(d)).map(d=>d.path);
const restoredPaths=new Set(restored.map(d=>d.path));const missing=[...expected.keys()].filter(p=>!restoredPaths.has(p));
const report={target:'local emulator only',project:DRILL_PROJECT,sourceReadTime:backup.readTime,sourceDatasetHash:backup.manifest.datasetHash,expectedDocuments:backup.documents.length,restoredDocuments:restored.length,matchingDocuments:restored.length-mismatches.length,mismatches,missing,elapsedSeconds:(Date.now()-started)/1000,passed:restored.length===backup.documents.length&&!mismatches.length&&!missing.length,limitations:['Firestore system create/update timestamps are not restored; typed field payloads and document IDs are preserved.','Auth users, Storage binaries, cloud IAM and real Firebase failure behaviour are outside this drill.']};
await fs.writeFile(path.join(path.dirname(input),'restore-drill-report.json'),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
