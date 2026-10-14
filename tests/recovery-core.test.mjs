import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECT,DRILL_PROJECT,STORES,EXTRA_PATHS,sha,canonical,documentHash,validateBackup,emulatorBase,assertPrivateOutput} from '../scripts/recovery-core.mjs';

function fixture() {
  const documents=[{path:'hammsStores/assets/records/asset-1',fields:{id:{integerValue:'9007199254740993'},qty:{doubleValue:0},tags:{arrayValue:{values:[{stringValue:'unchanged'}]}}}}];
  documents.forEach(d=>d.hash=documentHash(d));
  return {format:'hamms-firestore-typed-v1',project:PROJECT,database:'(default)',documents,missingPaths:EXTRA_PATHS,manifest:{documentCount:1,storeCounts:Object.fromEntries(STORES.map(s=>[s,s==='assets'?1:0])),datasetHash:sha(documents.map(d=>({path:d.path,hash:d.hash})))}};
}
test('canonical hashing ignores object key order but preserves array order',()=>{assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));assert.notEqual(sha([1,2]),sha([2,1]));});
test('typed large integer and zero payloads remain unchanged',()=>{const b=fixture();assert.equal(validateBackup(b).assets,1);assert.equal(b.documents[0].fields.id.integerValue,'9007199254740993');assert.equal(b.documents[0].fields.qty.doubleValue,0);});
test('tampered classifications fail validation',()=>{const b=fixture();b.documents[0].fields.tags.arrayValue.values[0].stringValue='changed';assert.throws(()=>validateBackup(b),/hash mismatch/);});
test('missing documents and missing stores fail validation',()=>{const b=fixture();b.documents=[];assert.throws(()=>validateBackup(b),/count mismatch/);const c=fixture();delete c.manifest.storeCounts.wo;assert.throws(()=>validateBackup(c),/counts mismatch/);});
test('duplicate document identity is rejected',()=>{const b=fixture();b.documents.push(b.documents[0]);b.manifest.documentCount=2;assert.throws(()=>validateBackup(b),/duplicate/);});
test('metadata coverage is mandatory',()=>{const b=fixture();b.missingPaths=[];assert.throws(()=>validateBackup(b),/coverage incomplete/);});
test('cloud, forwarded and wrong-project restore destinations are rejected',()=>{for(const host of ['firestore.googleapis.com:443','localhost:8185','127.0.0.1:8185@evil','127.0.0.1:80','127.0.0.1:99999',undefined])assert.throws(()=>emulatorBase(host,DRILL_PROJECT));assert.throws(()=>emulatorBase('127.0.0.1:8185',PROJECT));assert.match(emulatorBase('127.0.0.1:8185',DRILL_PROJECT),/^http:\/\/127/);});
test('real backup destinations inside the repository are rejected',()=>{assert.throws(()=>assertPrivateOutput('D:/Projects/DOPMC/cmms/public/backup.json','D:/Projects/DOPMC/cmms'));assert.throws(()=>assertPrivateOutput('D:/Projects/DOPMC/cmms/recovery-private','D:/Projects/DOPMC/cmms'));assert.equal(assertPrivateOutput('D:/Projects/DOPMC/hamms-recovery','D:/Projects/DOPMC/cmms'),'D:\\Projects\\DOPMC\\hamms-recovery');});
