import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc} from 'firebase/firestore';
import {createSecurityService,SECURITY_PROJECT} from '../security/service.mjs';
import {sha} from '../scripts/recovery-core.mjs';
import {billCarbon} from '../security/analysis-domain.mjs';
let service,env;const tokens={},clients={};
const op=(command,extra={})=>({command,operationId:crypto.randomUUID(),reason:'Synthetic energy verification',...extra});
async function send(body,role='admin'){try{return await service.execute(tokens[role],body);}catch(e){return {error:e.code||'internal',message:e.message};}}
const billRef=id=>service.db.doc('hammsStores/energyBills/records/'+id);
const factorPayload=(version,value=0.5,extra={})=>({gridRegion:'Synthetic grid',version,valueKgPerKwh:value,source:'Synthetic source; not a real emissions recommendation',publishedOn:'2025-01-01',validFrom:'2020-01-01',validTo:null,sourceVerified:true,...extra});
async function publish(version,value=0.5,extra={}){const r=await send(op('publishEnergyFactor',{store:'energyBills',payload:factorPayload(version,value,extra)}));assert.equal(r.status,'committed',JSON.stringify(r));return r.docId;}
async function configure(factorId,extra={}){const current=(await service.db.doc('energySettings/current').get()).data();return send(op('configureEnergy',{store:'energyBills',expectedVersion:current?._v||0,payload:{gridRegion:'Synthetic grid',baselineYear:2022,targetReductionPct:0,factorId,...extra}}));}
const bill=(period,extra={})=>op('createRecord',{store:'energyBills',expectedVersion:0,payload:{period,actualKwh:100,billAmount:500,...extra}});
before(async()=>{
 env=await initializeTestEnvironment({projectId:SECURITY_PROJECT,firestore:{host:'127.0.0.1',port:8186,rules:await fs.readFile('security/firestore.phase2.rules','utf8')}});await env.clearFirestore();service=await createSecurityService();await service.db.doc('system/writePolicy').set({maintenance:false});
 for(const role of ['admin','staff']){const uid='energy-'+role,email=uid+'@example.test';await service.auth.createUser({uid,email,password:'Synthetic-Only-123!'});await service.db.doc('staff/'+uid).set({active:true,role,facilityId:'dopmc'});const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Synthetic-Only-123!',returnSecureToken:true})});tokens[role]=(await r.json()).idToken;clients[role]=env.authenticatedContext(uid,{email}).firestore();}
});
after(async()=>{await service?.close();await env?.cleanup();});
test('staff cannot publish factors or configure shared settings',async()=>{for(const command of ['publishEnergyFactor','configureEnergy'])assert.equal((await send(op(command,{store:'energyBills',expectedVersion:0,payload:{}}),'staff')).error,'permission-denied');});
test('factor publication requires verified provenance, valid dates and unique region/version',async()=>{
 for(const patch of [{source:''},{sourceVerified:false},{valueKgPerKwh:-1},{valueKgPerKwh:Infinity},{publishedOn:'2099-01-01'},{validTo:'2019-01-01'}])assert.equal((await send(op('publishEnergyFactor',{payload:factorPayload(1,0.5,patch)}))).error,'invalid-argument');
 const id=await publish(1);assert.equal((await send(op('publishEnergyFactor',{payload:factorPayload(1)}))).error,'already-exists');assert.equal((await configure(id)).status,'committed');
});
test('new bills save immutable sourced factor/settings snapshots; later factor changes touch no historical bill',async()=>{
 const r=await send(bill('2026-01'),'staff');assert.equal(r.status,'committed');const before=(await billRef(r.docId).get()).data();assert.equal(before._factorSnapshot.valueKgPerKwh,0.5);assert.equal(before._carbonKg,50);assert.equal(before._energySettingsSnapshot.targetReductionPct,0);
 const second=await publish(2,0.9);await configure(second);assert.deepEqual((await billRef(r.docId).get()).data(),before);assert.equal(billCarbon(before),50);
});
test('explicit zero consumption, amount, factor and target are preserved',async()=>{
 const zero=await publish(3,0);await configure(zero);const r=await send(bill('2026-02',{actualKwh:0,billAmount:0}),'staff');assert.equal(r.status,'committed',JSON.stringify(r));const saved=(await billRef(r.docId).get()).data();assert.equal(saved.actualKwh,0);assert.equal(saved.billAmount,0);assert.equal(saved._factorSnapshot.valueKgPerKwh,0);assert.equal(saved._carbonKg,0);
});
test('unknown historical factors remain unknown after settings changes or ordinary bill edit',async()=>{
 const id='legacy-energy';await billRef(id).set({_docId:id,id:777777,_v:1,period:'2026-03',actualKwh:3659.5,billAmount:1440000,legacyEvidence:{retain:true}});
 const r=await send(op('updateRecord',{store:'energyBills',docId:id,expectedVersion:1,payload:{remarks:'Synthetic note only'}}),'staff');assert.equal(r.status,'committed');const saved=(await billRef(id).get()).data();assert.equal(saved._factorSnapshot,null);assert.equal(saved._carbonKg,null);assert.equal(saved.actualKwh,3659.5);assert.equal(saved.billAmount,1440000);assert.deepEqual(saved.legacyEvidence,{retain:true});
});
test('factor must cover complete monthly period and match configured region',async()=>{
 const partial=await publish(4,0.7,{validFrom:'2026-04-15',validTo:'2026-04-30'});assert.equal((await configure(partial,{gridRegion:'Wrong region'})).error,'invalid-argument');await configure(partial);const r=await send(bill('2026-04'),'staff');assert.equal(r.status,'committed');assert.equal((await billRef(r.docId).get()).data()._factorSnapshot,null);
});
test('settings use expected-version conflicts and both sessions read same shared state',async()=>{
 const old=(await service.db.doc('energySettings/current').get()).data();assert.equal((await configure(null)).status,'committed');const stale=await send(op('configureEnergy',{expectedVersion:old._v,payload:{gridRegion:'Synthetic grid',baselineYear:2020,targetReductionPct:5,factorId:null}}));assert.equal(stale.error,'aborted');const [a,b]=await Promise.all([service.inspect(tokens.staff,{energy:true}),service.inspect(tokens.admin,{energy:true})]);assert.deepEqual(a.energySettings,b.energySettings);
});
test('legacy settings endpoint cannot overwrite configured shared settings without version review',async()=>{
 const before=(await service.db.doc('energySettings/current').get()).data();const r=await send(op('setEnergySettings',{payload:{gridRegion:'Synthetic grid',emissionFactor:0.5,targetReductionPct:10,baselineYear:2020,factorSource:'Synthetic old client'}}));assert.equal(r.error,'failed-precondition');assert.deepEqual((await service.db.doc('energySettings/current').get()).data(),before);
});
test('bill period changes are rejected and archival retains period reservation for restoration',async()=>{
 const r=await send(bill('2026-05'),'staff');assert.equal((await send(op('updateRecord',{store:'energyBills',docId:r.docId,expectedVersion:1,payload:{period:'2027-05'}}),'staff')).error,'failed-precondition');
 assert.equal((await send(op('archiveRecord',{store:'energyBills',docId:r.docId,expectedVersion:1}),'staff')).status,'committed');assert.equal((await send(bill('2026-05'),'staff')).error,'already-exists');assert.equal((await send(op('restoreRecord',{store:'energyBills',docId:r.docId,expectedVersion:2}))).status,'committed');assert.equal((await billRef(r.docId).get()).data()._archived,false);
});
test('existing unreserved duplicates block new bill without altering legacy rows',async()=>{
 await billRef('old-a').set({period:'2026-06',actualKwh:3659.5,billAmount:1440000});const before=(await billRef('old-a').get()).data();assert.equal((await send(bill('2026-06'),'staff')).error,'already-exists');assert.deepEqual((await billRef('old-a').get()).data(),before);
});
test('clients cannot forge bill snapshots or mutate factor/settings/reservation evidence',async()=>{
 assert.equal((await send(bill('2026-07',{_factorSnapshot:{verified:true}}),'staff')).error,'invalid-argument');
 const factor=(await service.db.collection('energyFactors').limit(1).get()).docs[0];for(const role of ['staff','admin'])for(const path of [factor.ref.path,'energySettings/current','energyBillPeriods/dopmc_2026-01']){await assertFails(setDoc(doc(clients[role],path),{forged:true}));await assertFails(updateDoc(doc(clients[role],path),{valueKgPerKwh:999}));await assertFails(deleteDoc(doc(clients[role],path)));}await assertSucceeds(getDoc(doc(clients.staff,factor.ref.path)));
});
test('audit collision rolls back bill, unique reservation and operation outcome',async()=>{
 const body=bill('2026-08'),key=sha({uid:'energy-staff',operationId:body.operationId});await service.db.doc('auditEvents/'+key).set({syntheticCollision:true});assert.ok((await send(body,'staff')).error);assert.equal((await service.db.doc('energyBillPeriods/dopmc_2026-08').get()).exists,false);assert.equal((await billRef('energyBills_'+key.slice(0,32)).get()).exists,false);assert.equal((await service.db.doc('operationResults/'+key).get()).exists,false);
});
test('repeated bill operation returns one bill, reservation, snapshot and outcome',async()=>{
 const body=bill('2026-09'),[a,b]=await Promise.all([send(body,'staff'),send(body,'staff')]);assert.equal(a.status,'committed');assert.deepEqual(a,b);assert.equal((await service.db.collection('hammsStores/energyBills/records').where('period','==','2026-09').get()).size,1);
});
test('100 concurrent same-period creation pairs each produce exactly one facility bill',async()=>{
 for(let i=0;i<100;i++){const period=String(2030+Math.floor(i/12))+'-'+String(i%12+1).padStart(2,'0'),[a,b]=await Promise.all([send(bill(period),'staff'),send(bill(period),'staff')]);assert.equal([a,b].filter(r=>r.status==='committed').length,1);assert.equal([a,b].filter(r=>r.error==='already-exists').length,1);const rows=await service.db.collection('hammsStores/energyBills/records').where('period','==',period).get();assert.equal(rows.size,1);const reservation=(await service.db.doc('energyBillPeriods/dopmc_'+period).get()).data();assert.equal(reservation.billDocId,rows.docs[0].id);}
});
