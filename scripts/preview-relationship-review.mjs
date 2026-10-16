import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateBackup,assertPrivateOutput} from './recovery-core.mjs';
import {reviewRelationships,token} from '../security/relationship-domain.mjs';
const input=process.argv[2];if(!input)throw Error('Provide a private typed Firestore backup');
const source=JSON.parse(await fs.readFile(input,'utf8'));validateBackup(source);
function decode(v){if('stringValue'in v)return v.stringValue;if('integerValue'in v){const n=Number(v.integerValue);return Number.isSafeInteger(n)?n:v.integerValue;}if('doubleValue'in v)return v.doubleValue;if('booleanValue'in v)return v.booleanValue;if('nullValue'in v)return null;if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);if(v.mapValue)return fields(v.mapValue.fields||{});if('timestampValue'in v)return v.timestampValue;return structuredClone(v);}
function fields(f){return Object.fromEntries(Object.entries(f).map(([k,v])=>[k,decode(v)]));}
const data={assets:[],wo:[],locations:[]};for(const d of source.documents){const [,store,,docId]=d.path.split('/');if(['assets','wo'].includes(store))data[store].push({...fields(d.fields),_docId:docId});}
// Candidate location catalogue is evidence only, never written to Firestore. No alias inference.
const names=[...new Set([...data.assets.map(a=>a.location),...data.wo.map(w=>w.location)].filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))];
data.locations=names.map((name,i)=>({docId:'candidate-location-'+(i+1),name,aliases:[],unverified:true}));
const report={...reviewRelationships(data),sourceReadTime:source.readTime,sourceDatasetHash:source.manifest.datasetHash,generatedAt:new Date().toISOString(),candidateLocations:data.locations,rampEvidence:data.wo.filter(w=>w.code==='ELEC-HI-0011').map(w=>({woId:w._docId,asset:w.asset,location:w.location,section:w.section,candidates:data.assets.filter(a=>a.assetCode==='OT-ELEC-RAMP-01'||a.assetCode==='OT-ELEC-RAMP-03').map(a=>({docId:a._docId,assetCode:a.assetCode,name:a.name,location:a.location})),previousUserChoice:'OT-ELEC-RAMP-01',status:'Re-verify exact current records before any proposal; prior name/code choice is not permission to mutate this snapshot.'})),rsaAssets:data.assets.filter(a=>token(a.location)==='dietary rsa').map(a=>({docId:a._docId,assetCode:a.assetCode,name:a.name,location:a.location}))};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=assertPrivateOutput(process.argv[3]||path.join(path.dirname(input),'relationship-review.json'),root);
await fs.writeFile(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({output,sourceReadTime:report.sourceReadTime,...report.counts,proposedWrites:0,rsaAssetCount:report.rsaAssets.length,rampEvidenceCount:report.rampEvidence.length}));
