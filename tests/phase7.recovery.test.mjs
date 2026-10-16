import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,deleteDoc,updateDoc} from 'firebase/firestore';
import {createSecurityService,SECURITY_PROJECT} from '../security/service.mjs';
import {makeBackup} from '../security/recovery-domain.mjs';
import {sha} from '../scripts/recovery-core.mjs';
let service,env,root;const tokens={},clients={};
const request=(command,extra={})=>({command,operationId:crypto.randomUUID(),reason:'Synthetic phase 7 test',...extra});
const action=(b,role='admin',options)=>service.recovery(tokens[role],b,options);
const row=(id,extra={})=>({path:'hammsStores/safety/records/'+id,fields:{id:{integerValue:String(Number(id.replace(/\D/g,''))||1)},_docId:{stringValue:id},_v:{integerValue:'1'},title:{stringValue:'Synthetic incident '+id},...extra}});
const stage=(mode,backup,extra={})=>action({action:'stage',operationId:crypto.randomUUID(),reason:'Synthetic recovery only',mode,...(backup?{backup}:{}),...extra});
async function approved(s){await action({action:'approve',jobId:s.jobId,previewHash:s.previewHash,userVerified:true,verificationReference:'Synthetic fixture approval; no real records',reason:'Synthetic emulator verification'});return action({action:'start',jobId:s.jobId});}
async function drain(id){let s;do{s=await action({action:'step',jobId:id});}while(!['completed','rolled-back'].includes(s.status));return s;}
before(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'hamms-phase7-'));env=await initializeTestEnvironment({projectId:SECURITY_PROJECT,firestore:{host:'127.0.0.1',port:8186,rules:await fs.readFile('security/firestore.phase2.rules','utf8')}});service=await createSecurityService(SECURITY_PROJECT,{recoveryRoot:root});
 for(const role of ['admin','staff']){const uid='recovery-'+role,email=uid+'@example.test';await service.auth.createUser({uid,email,password:'Synthetic-Only-123!'});const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Synthetic-Only-123!',returnSecureToken:true})});tokens[role]=(await r.json()).idToken;clients[role]=env.authenticatedContext(uid,{email}).firestore();}
});
beforeEach(async()=>{await env.clearFirestore();await service.db.doc('system/writePolicy').set({maintenance:false});for(const role of ['admin','staff'])await service.db.doc('staff/recovery-'+role).set({active:true,role,facilityId:'dopmc'});});
after(async()=>{await service?.close();await env?.cleanup();/* Synthetic snapshots retained privately for inspection. */});
test('recovery rejects staff, missing identity, cloud project and private roots in the repo',async()=>{
 for(const b of [{action:'snapshot'},{action:'stage',operationId:'forged',mode:'reset',reason:'forged'},{action:'step',jobId:'forged'}])await assert.rejects(action(b,'staff'),e=>e.code==='permission-denied');await assert.rejects(service.recovery('invalid',{action:'snapshot'}),e=>e.code==='unauthenticated');await assert.rejects(createSecurityService('demoapp-7864a'));await assert.rejects(createSecurityService(SECURITY_PROJECT,{recoveryRoot:path.resolve('public/backups')}));
});
test('stage is read-only and exact preview verification is required',async()=>{
 const b=makeBackup(SECURITY_PROJECT,[row('one1')]),s=await stage('replace',b);assert.equal((await service.db.doc(row('one1').path).get()).exists,false);assert.equal((await service.db.doc('system/writePolicy').get()).data().maintenance,false);
 await assert.rejects(action({action:'start',jobId:s.jobId}));await assert.rejects(action({action:'approve',jobId:s.jobId,previewHash:'wrong',userVerified:true,verificationReference:'Synthetic approval reference',reason:'Synthetic'}));await assert.rejects(action({action:'approve',jobId:s.jobId,previewHash:s.previewHash,userVerified:false,verificationReference:'Synthetic approval reference',reason:'Synthetic'}));assert.equal(s.preview.changes[0].after.title.stringValue,'Synthetic incident one1');
});
test('invalid/partial replacement produces zero operational changes and takes no maintenance lock',async()=>{
 for(const mutate of [b=>b.coverage.pop(),b=>b.manifest.datasetHash='bad',b=>b.documents[0].fields.id.integerValue='9',b=>b.format='hamms-firestore-typed-v1']){const b=makeBackup(SECURITY_PROJECT,[row('one1')]);mutate(b);await assert.rejects(stage('replace',b));}
 assert.equal((await service.db.collection('hammsStores/safety/records').get()).size,0);assert.equal((await service.db.collection('privilegedJobs').get()).size,0);assert.equal((await service.db.doc('system/writePolicy').get()).data().maintenance,false);
});
test('stale preview refuses execution without touching operational records',async()=>{
 const s=await stage('replace',makeBackup(SECURITY_PROJECT,[row('one1')]));await service.db.doc('hammsStores/safety/records/unreviewed').set({title:'Changed after staging'});await assert.rejects(approved(s),e=>e.code==='aborted');assert.equal((await service.db.doc(row('one1').path).get()).exists,false);assert.equal((await service.db.doc('system/writePolicy').get()).data().maintenance,false);
});
test('maintenance blocks all ordinary writes and administrator force-unlock',async()=>{
 const s=await approved(await stage('replace',makeBackup(SECURITY_PROJECT,[row('one1')])));
 await assert.rejects(service.execute(tokens.staff,request('createRecord',{store:'safety',expectedVersion:0,payload:{}})),e=>e.code==='unavailable');await assert.rejects(service.execute(tokens.admin,request('setMaintenance',{payload:{maintenance:false}})),e=>e.code==='failed-precondition');await drain(s.jobId);
});
test('5000-record restore: three interruption points, restart/resume and exact target reconciliation',async()=>{
 const started=Date.now(),source=makeBackup(SECURITY_PROJECT,Array.from({length:5000},(_,i)=>row('large'+(i+1),i===0?{large:{integerValue:'9007199254740993'},bytes:{bytesValue:'AQID'},stamp:{timestampValue:'2026-10-16T12:00:00.123456Z'},zero:{doubleValue:0}}:{})));
 const s=await approved(await stage('replace',source)),b={action:'step',jobId:s.jobId};
 await assert.rejects(action(b,'admin',{failAt:'before-batch'}));assert.equal((await action({action:'status',jobId:s.jobId})).cursor,0);
 for(let i=0;i<25;i++)await action(b);await assert.rejects(action(b,'admin',{failAt:'after-batch'}));assert.equal((await action({action:'status',jobId:s.jobId})).cursor,2600);
 await service.close();service=await createSecurityService(SECURITY_PROJECT,{recoveryRoot:root});for(let i=26;i<49;i++)await action(b);
 await assert.rejects(action(b,'admin',{failAt:'before-finalize'}));assert.equal((await action({action:'status',jobId:s.jobId})).cursor,5000);assert.equal((await service.db.doc('system/writePolicy').get()).data().maintenance,true);
 let done;try{done=await action(b);}catch(e){const actual=await action({action:'snapshot'}),first=actual.documents.find(d=>d.path===row('large1').path),expected=s.preview.changes.find(d=>d.path===row('large1').path);console.log('Synthetic typed round-trip diagnostic',JSON.stringify({expected:expected.after,actual:first?.fields}));throw e;}const again=await action(b);assert.equal(done.status,'completed');assert.deepEqual(done,again);assert.equal((await service.db.collection('hammsStores/safety/records').get()).size,5000);
 const backup=await action({action:'snapshot'}),actual=new Map(backup.documents.map(d=>[d.path,d]));for(const c of s.preview.changes)assert.deepEqual(actual.get(c.path).fields,c.after);assert.equal(actual.get(row('large1').path).fields.large.integerValue,'9007199254740993');assert.deepEqual(actual.get(row('large1').path).fields.zero,{doubleValue:0});
 assert.equal((await service.db.collection('auditEvents').where('jobId','==',s.jobId).where('command','==','recoveryBatch').get()).size,50);assert.equal((await service.db.doc('auditEvents/'+s.jobId+'_outcome').get()).exists,true);assert.equal((await service.db.doc('operationResults/recovery_'+s.jobId).get()).exists,true);
 await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/phase7-recovery-metrics.json',JSON.stringify({sourceRecords:5000,matching:5000,batches:50,interruptionPoints:3,duplicateBatchEffects:0,elapsedSeconds:(Date.now()-started)/1000,privateSnapshots:root}));
});
test('interrupted reset rolls back original payloads with no quantity compensation',async()=>{
 await service.db.doc('hammsStores/inventory/records/i').set({_docId:'i',_v:1,id:10,qty:12});await service.db.doc('hammsStores/wo/records/w').set({_docId:'w',_v:1,id:20,status:'Open',materials:[]});
 const before=await action({action:'snapshot'}),s=await approved(await stage('reset'));await assert.rejects(action({action:'step',jobId:s.jobId},'admin',{batchSize:1,failAt:'after-batch'}));await action({action:'rollback',jobId:s.jobId});const done=await drain(s.jobId);assert.equal(done.status,'rolled-back');const after=await action({action:'snapshot'});for(const d of before.documents.filter(d=>d.path.startsWith('hammsStores/')))assert.deepEqual(Object.fromEntries(Object.entries(after.documents.find(x=>x.path===d.path).fields).filter(([k])=>!['_v','_updatedBy','_updatedAt','_committedAt','_recoveryPreparedAt'].includes(k))),Object.fromEntries(Object.entries(d.fields).filter(([k])=>!['_v','_updatedBy','_updatedAt','_committedAt','_recoveryPreparedAt'].includes(k))));assert.equal((await service.db.doc('hammsStores/inventory/records/i').get()).data().qty,12);
});
test('typed plan tampering blocks resume and retains maintenance lock',async()=>{
 const s=await approved(await stage('replace',makeBackup(SECURITY_PROJECT,[row('one1')]))),p=path.join(root,s.jobId,'plan.json');await fs.appendFile(p,' ');const plan=JSON.parse(await fs.readFile(p,'utf8'));plan.changes[0].fields.title.stringValue='tampered';await fs.writeFile(p,JSON.stringify(plan));await assert.rejects(action({action:'step',jobId:s.jobId}),e=>e.code==='failed-precondition');assert.equal((await service.db.doc('system/writePolicy').get()).data().maintenance,true);assert.equal((await service.db.doc(row('one1').path).get()).exists,false);
});
test('out-of-band write fails reconciliation and cannot unlock maintenance',async()=>{
 const s=await approved(await stage('replace',makeBackup(SECURITY_PROJECT,[row('one1')])));await assert.rejects(action({action:'step',jobId:s.jobId},'admin',{failAt:'before-finalize'}));await service.db.doc(row('one1').path).update({title:'out of band'});await assert.rejects(action({action:'step',jobId:s.jobId}),e=>e.code==='failed-precondition');assert.equal((await service.db.doc('system/writePolicy').get()).data().maintenance,true);
});
test('staff archive/admin restore keep original snapshots with one immutable audit/outcome each',async()=>{
 const ref=service.db.doc('hammsStores/safety/records/archive');await ref.set({_docId:'archive',_v:1,id:1,title:'Original',unknownLegacy:{zero:0}});const original=(await ref.get()).data();
 const body=request('archiveRecord',{store:'safety',docId:'archive',expectedVersion:1}),r=await service.execute(tokens.staff,body),again=await service.execute(tokens.staff,body);assert.deepEqual(r,again);const key=sha({uid:'recovery-staff',operationId:body.operationId});assert.deepEqual((await service.db.doc('archiveSnapshots/'+key).get()).data().original,original);assert.equal((await service.db.doc('auditEvents/'+key).get()).data().outcome,'committed');await assert.rejects(service.execute(tokens.staff,request('restoreRecord',{store:'safety',docId:'archive',expectedVersion:2})));await service.execute(tokens.admin,request('restoreRecord',{store:'safety',docId:'archive',expectedVersion:2}));assert.deepEqual((await ref.get()).data().unknownLegacy,{zero:0});
 for(const role of ['admin','staff'])for(const p of ['auditEvents/'+key,'archiveSnapshots/'+key,'privilegedJobs/forged']){await assertFails(setDoc(doc(clients[role],p),{forged:true}));await assertFails(updateDoc(doc(clients[role],p),{forged:true}));await assertFails(deleteDoc(doc(clients[role],p)));}
});
test('purge is separately reviewed, archive-only, recoverable in private pre-operation snapshot',async()=>{
 await service.db.doc(row('purge1').path).set({_docId:'purge1',_v:1,id:1,_archived:true,title:'Synthetic obsolete record'});const s=await stage('purge',null,{paths:[row('purge1').path]});assert.equal((await service.db.doc(row('purge1').path).get()).exists,true);await approved(s);await drain(s.jobId);assert.equal((await service.db.doc(row('purge1').path).get()).exists,false);const backup=JSON.parse(await fs.readFile(path.join(root,s.jobId,'pre-operation.json'),'utf8'));assert.ok(backup.documents.some(d=>d.path===row('purge1').path));
});
test('deactivation after approval blocks start',async()=>{const s=await stage('reset');await action({action:'approve',jobId:s.jobId,previewHash:s.previewHash,userVerified:true,verificationReference:'Synthetic fixture verification',reason:'Synthetic'});await service.db.doc('staff/recovery-admin').update({active:false});await assert.rejects(action({action:'start',jobId:s.jobId}),e=>e.code==='permission-denied');});
for(const fault of ['before-batch','after-batch','before-finalize'])test('independent restore/resume drill '+fault,async()=>{
 const s=await approved(await stage('replace',makeBackup(SECURITY_PROJECT,[row('drill1'),row('drill2')])));
 await assert.rejects(action({action:'step',jobId:s.jobId},'admin',{failAt:fault}));assert.equal((await service.db.doc('system/writePolicy').get()).data().maintenance,true);
 assert.equal((await drain(s.jobId)).status,'completed');assert.equal((await service.db.collection('hammsStores/safety/records').get()).size,2);assert.equal((await service.db.collection('auditEvents').where('jobId','==',s.jobId).where('command','==','recoveryBatch').get()).size,1);
});
test('restore and rollback versions reject drafts made before recovery',async()=>{
 const ref=service.db.doc(row('stale1').path);await ref.set({_docId:'stale1',_v:8,id:1,title:'Current'});
 const s=await approved(await stage('replace',makeBackup(SECURITY_PROJECT,[row('stale1',{title:{stringValue:'Older backup'}})])));
 await assert.rejects(action({action:'step',jobId:s.jobId},'admin',{failAt:'before-finalize'}));assert.equal((await ref.get()).data()._v,9);await action({action:'rollback',jobId:s.jobId});await drain(s.jobId);assert.equal((await ref.get()).data()._v,10);assert.equal((await ref.get()).data().title,'Current');await assert.rejects(service.execute(tokens.staff,request('updateRecord',{store:'safety',docId:'stale1',expectedVersion:8,payload:{}})),e=>e.code==='aborted');
});
