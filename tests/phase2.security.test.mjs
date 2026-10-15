import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {getDoc,setDoc,deleteDoc,updateDoc,doc,collection,getDocs} from 'firebase/firestore';
import {STORES,sha} from '../scripts/recovery-core.mjs';
import {createSecurityService,requireEmulators,SECURITY_PROJECT} from '../security/service.mjs';
import {fixtures} from './phase2-fixtures.mjs';

requireEmulators(SECURITY_PROJECT);
let env,service,url;
const tokens={},clients={};
const names=['admin','staff','inactive','nonmember','wrongfacility'];
const settings={gridRegion:'Test',emissionFactor:0,targetReductionPct:0,baselineYear:2026,factorSource:'Synthetic test only'};
const op=(command,extra={})=>({command,operationId:crypto.randomUUID(),reason:'Synthetic emulator test only',...extra});
async function command(actor,body) {
  const r=await fetch(url+'/commands',{method:'POST',headers:{'Content-Type':'application/json',...(tokens[actor]?{Authorization:'Bearer '+tokens[actor]}:{})},body:JSON.stringify(body)});
  const data=await r.json();return {...data,outcomeStatus:data.status,status:r.status};
}
async function seedRecord(store,id,extra={}) {
  await service.db.doc(`hammsStores/${store}/records/${id}`).set({...fixtures[store],id:100000+Math.floor(Math.random()*1e9),_docId:id,_v:1,_updatedAt:1,_updatedBy:'original@example.test',...extra});
}
before(async()=>{
  env=await initializeTestEnvironment({projectId:SECURITY_PROJECT,firestore:{host:'127.0.0.1',port:8186,rules:await fs.readFile('security/firestore.phase2.rules','utf8')}});
  await env.clearFirestore();service=await createSecurityService();url=await service.listen();
  await service.db.doc('system/writePolicy').set({maintenance:false});
  await service.db.doc('locations/test-room').set({name:'Test room'});
  for(const name of names) {
    const email=name+'@example.test';await service.auth.createUser({uid:name,email,password:'Synthetic-Only-123!'});
    const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Synthetic-Only-123!',returnSecureToken:true})});
    const j=await r.json();assert.ok(j.idToken);tokens[name]=j.idToken;
    // Fake admin claim must never grant access beyond the protected membership.
    clients[name]=env.authenticatedContext(name,{email,admin:true}).firestore();
    if(name!=='nonmember')await service.db.doc('staff/'+name).set({role:name==='admin'?'admin':'staff',active:name!=='inactive',facilityId:name==='wrongfacility'?'other':'dopmc'});
  }
  clients.anonymous=env.unauthenticatedContext().firestore();
  for(const store of STORES)await seedRecord(store,'seed-'+store);
  await service.db.doc('hammsMeta/state').set({inpatientToday:1,personnel:{test:'Synthetic'}});
});
after(async()=>{if(service)await service.close();if(env)await env.cleanup();});

for(const actor of [...names,'anonymous'])for(const store of STORES) {
  test(`rules: ${actor} read ${store}`,async()=>{
    const read=getDoc(doc(clients[actor],`hammsStores/${store}/records/seed-${store}`));
    await (['admin','staff'].includes(actor)?assertSucceeds(read):assertFails(read));
  });
}
for(const actor of ['staff','admin'])for(const store of STORES) {
  test(`rules: ${actor} cannot directly mutate ${store}`,async()=>{
    const ref=doc(clients[actor],`hammsStores/${store}/records/seed-${store}`);
    await assertFails(updateDoc(ref,{_v:2}));await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(clients[actor],`hammsStores/${store}/records/forged-${actor}`),fixtures[store]));
  });
}
test('rules: shared metadata, legacy data, settings, audit and membership writes denied even to admin',async()=>{
  for(const actor of ['staff','admin'])for(const p of ['hammsMeta/state','hamms/mainData','energySettings/current','system/writePolicy','auditEvents/forged','staff/'+actor,'operationResults/forged','privilegedJobs/forged']) {
    await assertFails(setDoc(doc(clients[actor],p),{active:true,role:'admin'}));await assertFails(deleteDoc(doc(clients[actor],p)));
  }
});
test('rules: staff directory list restricted; own membership remains readable to inactive user',async()=>{
  await assertFails(getDocs(collection(clients.staff,'staff')));await assertSucceeds(getDocs(collection(clients.admin,'staff')));
  await assertSucceeds(getDoc(doc(clients.inactive,'staff/inactive')));await assertFails(getDoc(doc(clients.staff,'staff/admin')));
});
test('rules: deny unknown stores and unknown collections',async()=>{
  for(const p of ['hammsStores/unknown/records/a','unrecognized/a'])await assertFails(getDoc(doc(clients.admin,p)));
});
for(const actor of ['anonymous','nonmember','inactive','wrongfacility']) {
  test(`backend: ${actor} cannot mutate using Admin SDK command path`,async()=>{
    const r=await command(actor,op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets}));assert.equal(r.status,actor==='anonymous'?401:403);
  });
}
for(const name of ['setMembership','setMaintenance','setEnergySettings','requestRestore','requestReset','requestPurge','restoreRecord']) {
  test(`backend: staff cannot ${name} despite fake admin UI/claims`,async()=>{
    const extra=name==='restoreRecord'?{store:'assets',docId:'seed-assets',expectedVersion:1}:{};
    assert.equal((await command('staff',op(name,extra))).status,403);
  });
}
for(const store of STORES) {
  test(`backend: schema enforces protected fields in ${store}`,async()=>{
    const r=await command('staff',op('createRecord',{store,expectedVersion:0,payload:{...fixtures[store],_updatedBy:'forged'}}));
    assert.equal(r.status,store==='issuance'?412:400);
  });
  if(store!=='issuance')test(`backend: staff can create valid ${store}`,async()=>{
    const body=op('createRecord',{store,expectedVersion:0,payload:fixtures[store]});const r=await command('staff',body);assert.equal(r.status,200,JSON.stringify(r));
    const saved=(await service.db.doc(`hammsStores/${store}/records/${r.docId}`).get()).data();
    assert.equal(saved._docId,r.docId);assert.equal(saved._v,1);assert.equal(saved._updatedBy,'staff@example.test');assert.ok(saved._committedAt.toMillis()>0);
    const key=sha({uid:'staff',operationId:body.operationId});assert.ok((await service.db.doc('auditEvents/'+key).get()).exists);
  });
}
test('backend: repeated operation is idempotent; changed payload with same ID rejected',async()=>{
  const b=op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets});const a=await command('staff',b),r=await command('staff',b);assert.deepEqual(a,r);
  assert.equal((await command('staff',{...b,payload:{...fixtures.assets,name:'Different'}})).status,409);
});
test('backend: stale updates conflict and untouched legacy fields survive',async()=>{
  await seedRecord('assets','legacy-safe',{legacyExtra:{classification:'KEEP-EXACTLY'}});
  const req=()=>op('updateRecord',{store:'assets',docId:'legacy-safe',expectedVersion:1,payload:{remarks:'Reviewed test update'}});
  assert.equal((await command('staff',req())).status,200);assert.equal((await command('staff',req())).status,409);
  const d=(await service.db.doc('hammsStores/assets/records/legacy-safe').get()).data();assert.equal(d._v,2);assert.equal(d.legacyExtra.classification,'KEEP-EXACTLY');
});
test('backend: archive retains payload, staff restore denied, admin restore audited',async()=>{
  await seedRecord('assets','archive-test');const ref=service.db.doc('hammsStores/assets/records/archive-test');const old=(await ref.get()).data();
  assert.equal((await command('staff',op('archiveRecord',{store:'assets',docId:'archive-test',expectedVersion:1}))).status,200);
  const archived=(await ref.get()).data();assert.equal(archived.name,old.name);assert.equal(archived.id,old.id);assert.equal(archived._archived,true);
  assert.equal((await command('staff',op('restoreRecord',{store:'assets',docId:'archive-test',expectedVersion:2}))).status,403);
  assert.equal((await command('admin',op('restoreRecord',{store:'assets',docId:'archive-test',expectedVersion:2}))).status,200);assert.equal((await ref.get()).data()._archived,false);
});
test('backend: stock edits and material WO operations fail closed before Phase 4',async()=>{
  assert.equal((await command('staff',op('updateRecord',{store:'inventory',docId:'seed-inventory',expectedVersion:1,payload:{qty:100}}))).status,412);
  assert.equal((await command('staff',op('createRecord',{store:'inventory',expectedVersion:0,payload:{...fixtures.inventory,qty:100}}))).status,412);
  assert.equal((await command('staff',op('createRecord',{store:'wo',expectedVersion:0,payload:{...fixtures.wo,materials:[{invId:1,qty:1}]}}))).status,412);
  assert.equal((await command('staff',op('archiveRecord',{store:'inventory',docId:'seed-inventory',expectedVersion:1}))).status,412);
});
test('backend: admin settings allowed with provenance; staff and malformed factors rejected',async()=>{
  assert.equal((await command('admin',op('setEnergySettings',{payload:settings}))).status,200);
  assert.equal((await command('admin',op('setEnergySettings',{payload:{...settings,emissionFactor:-1}}))).status,400);
  assert.equal((await command('staff',op('setEnergySettings',{payload:settings}))).status,403);
});
for(const cmd of ['requestRestore','requestReset','requestPurge'])test(`backend: admin ${cmd} only queues an unexecuted job`,async()=>{
  const r=await command('admin',op(cmd));assert.equal(r.status,200);assert.equal(r.jobId.length,64);assert.equal(r.outcomeStatus,'awaiting-implementation-and-review');
  const job=(await service.db.doc('privilegedJobs/'+r.jobId).get()).data();assert.equal(job.status,'awaiting-implementation-and-review');assert.equal((await service.db.collection('hammsStores/assets/records').get()).empty,false);
});
test('backend: maintenance blocks normal writes; administrator can unlock',async()=>{
  assert.equal((await command('admin',op('setMaintenance',{payload:{maintenance:true}}))).status,200);
  assert.equal((await command('staff',op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets}))).status,503);
  assert.equal((await command('admin',op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets}))).status,503);
  assert.equal((await command('admin',op('setMaintenance',{payload:{maintenance:false}}))).status,200);
});
test('backend and rules: membership revocation blocks an existing signed-in session',async()=>{
  const body=active=>op('setMembership',{targetUid:'staff',payload:{role:'staff',active,facilityId:'dopmc'}});
  assert.equal((await command('admin',body(false))).status,200);
  await assertFails(getDoc(doc(clients.staff,'hammsStores/assets/records/seed-assets')));
  assert.equal((await command('staff',op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets}))).status,403);
  assert.equal((await command('admin',body(true))).status,200);await assertSucceeds(getDoc(doc(clients.staff,'hammsStores/assets/records/seed-assets')));
});
test('backend: admin cannot demote or deactivate self, preventing last-admin lockout',async()=>assert.equal((await command('admin',op('setMembership',{targetUid:'admin',payload:{role:'staff',active:false,facilityId:'dopmc'}}))).status,412));
test('backend: malformed JSON, token, command, actor and versions rejected',async()=>{
  const base=op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets});
  for(const patch of [{actorUid:'admin'},{expectedVersion:-1},{command:'factoryResetNow'},{operationId:'../escape'}])assert.equal((await command('staff',{...base,...patch})).status,400);
  const r=await fetch(url+'/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer invalid'},body:JSON.stringify(base)});assert.equal(r.status,401);
  const malformed=await fetch(url+'/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.staff},body:'{'});assert.equal(malformed.status,400);
});
test('backend: disabled Auth account denied with its existing token',async()=>{
  await service.auth.updateUser('staff',{disabled:true});
  try {assert.equal((await command('staff',op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets}))).status,401);}
  finally {await service.auth.updateUser('staff',{disabled:false});}
});
test('backend: failed audit creation rolls back operational record and outcome',async()=>{
  const b=op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets});
  const key=sha({uid:'staff',operationId:b.operationId});
  await service.db.doc('auditEvents/'+key).set({testConflict:true});
  const r=await command('staff',b);assert.equal(r.status,500);
  assert.equal((await service.db.doc('hammsStores/assets/records/assets_'+key.slice(0,32)).get()).exists,false);
  assert.equal((await service.db.doc('operationResults/'+key).get()).exists,false);
});
test('rules: audit reads are admin-only and command results owner-only',async()=>{
  const b=op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets});assert.equal((await command('staff',b)).status,200);
  const key=sha({uid:'staff',operationId:b.operationId});
  await assertSucceeds(getDoc(doc(clients.admin,'auditEvents/'+key)));await assertFails(getDoc(doc(clients.staff,'auditEvents/'+key)));
  await assertSucceeds(getDoc(doc(clients.staff,'operationResults/'+key)));await assertFails(getDoc(doc(clients.admin,'operationResults/'+key)));
});
