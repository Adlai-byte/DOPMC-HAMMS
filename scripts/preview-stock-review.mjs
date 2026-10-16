import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateBackup,assertPrivateOutput} from './recovery-core.mjs';
import {reviewStockData} from '../security/stock-review.mjs';
const input=process.argv[2];if(!input)throw Error('Provide a private typed Firestore backup path');
const source=JSON.parse(await fs.readFile(input,'utf8'));validateBackup(source);
function decode(v){if('stringValue'in v)return v.stringValue;if('integerValue'in v){const n=Number(v.integerValue);return Number.isSafeInteger(n)?n:v.integerValue;}if('doubleValue'in v)return v.doubleValue;if('booleanValue'in v)return v.booleanValue;if('nullValue'in v)return null;if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);if(v.mapValue)return fields(v.mapValue.fields||{});if('timestampValue'in v)return v.timestampValue;return structuredClone(v);}
function fields(f){return Object.fromEntries(Object.entries(f).map(([k,v])=>[k,decode(v)]));}
const data={wo:[],inventory:[],issuance:[]};for(const d of source.documents){const [,store,,docId]=d.path.split('/');if(data[store])data[store].push({...fields(d.fields),_docId:docId});}
const report={...reviewStockData(data),sourceReadTime:source.readTime,sourceDatasetHash:source.manifest.datasetHash,generatedAt:new Date().toISOString()};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=assertPrivateOutput(process.argv[3]||path.join(path.dirname(input),'stock-review.json'),root);
await fs.writeFile(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({output,sourceReadTime:report.sourceReadTime,...report.counts,proposedWrites:0}));
