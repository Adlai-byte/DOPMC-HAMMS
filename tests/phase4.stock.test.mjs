import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc} from 'firebase/firestore';
import {createSecurityService,SECURITY_PROJECT} from '../security/service.mjs';
import {sha} from '../scripts/recovery-core.mjs';
import {fixtures} from './phase2-fixtures.mjs';

let service,env;const tokens={},clients={};
const op=(command,extra={})=>({command,operationId:crypto.randomUUID(),reason:'Synthetic physical stock test',...extra});
const invRef=id=>service.db.doc('hammsStores/inventory/records/'+id);
const woRef=id=>service.db.doc('hammsStores/wo/records/'+id);
const issueRef=id=>service.db.doc('hammsStores/issuance/records/'+id);
async function send(body,actor='staff'){try{return await service.execute(tokens[actor],body);}catch(e){return {error:e.code||'internal',message:e.message};}}
async function inventory(qty=10){const r=await send(op('createRecord',{store:'inventory',expectedVersion:0,payload:{...fixtures.inventory,description:'Synthetic stock '+crypto.randomUUID()}}));assert.equal(r.status,'committed',JSON.stringify(r));if(qty){const receipt=await send(op('receiveStock',{store:'inventory',docId:r.docId,expectedVersion:1,payload:{quantity:qty,reference:'TEST-DELIVERY'}}));assert.equal(receipt.status,'committed',JSON.stringify(receipt));}return r.docId;}
async function invVersions(ids){const result={};for(const id of [...new Set(ids)])result[id]=(await invRef(id).get()).data()._v;return result;}
const material=(invDocId,qty,lineId='line-one')=>({invDocId,qty,lineId,issuedTo:'Synthetic staff'});
async function saveWO(materials,old=null,extra={}){return send(op('saveWorkOrder',{store:'wo',expectedVersion:old?.version||0,...(old?{docId:old.docId}:{}),payload:{record:old?{remarks:'Synthetic edit'}:fixtures.wo,materials,inventoryVersions:await invVersions(materials.map(m=>m.invDocId)),...extra}}));}
async function reconcile(id){
  const item=(await invRef(id).get()).data(),ledger=(await service.db.doc('inventoryLedgers/'+id).get()).data();
  const rows=(await service.db.collection('inventoryMovements').where('invDocId','==',id).get()).docs.map(d=>d.data());
  const sum=rows.reduce((s,r)=>s+r.deltaUnits,0);assert.equal(Math.round(item.qty*10000),sum);assert.equal(ledger.balanceUnits,sum);assert.equal(new Set(rows.map(r=>r.sequence)).size,rows.length);return rows;
}
before(async()=>{
  env=await initializeTestEnvironment({projectId:SECURITY_PROJECT,firestore:{host:'127.0.0.1',port:8186,rules:await fs.readFile('security/firestore.phase2.rules','utf8')}});await env.clearFirestore();service=await createSecurityService();
  for(const [uid,role]of [['stock-staff','staff'],['stock-admin','admin']]){
    await service.auth.createUser({uid,email:uid+'@example.test',password:'Synthetic-Only-123!'});await service.db.doc('staff/'+uid).set({role,active:true,facilityId:'dopmc'});
    const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:uid+'@example.test',password:'Synthetic-Only-123!',returnSecureToken:true})});tokens[role]=(await r.json()).idToken;clients[role]=env.authenticatedContext(uid,{email:uid+'@example.test'}).firestore();
  }
  await service.db.doc('system/writePolicy').set({maintenance:false});await service.db.doc('locations/test-room').set({name:'Test room'});
});
after(async()=>{await service?.close();await env?.cleanup();});

test('receipt, signed adjustment and manual issuance reconcile exactly',async()=>{
  const id=await inventory(10);
  let r=await send(op('adjustStock',{store:'inventory',docId:id,expectedVersion:2,payload:{quantity:-0.125,reference:'TEST-COUNT'}}));assert.equal(r.status,'committed');
  r=await send(op('issueStock',{store:'issuance',expectedVersion:0,payload:{invDocId:id,qty:1.2345,issuedTo:'Test',date:'2026-10-16',inventoryVersion:3}}));assert.equal(r.status,'committed',JSON.stringify(r));
  assert.equal((await invRef(id).get()).data().qty,8.6405);await reconcile(id);
  const row=(await issueRef(r.docId).get()).data();assert.equal(row.invDocId,id);assert.equal(row.source,'manual');
});
test('manual physical returns are bounded and preserved as movements',async()=>{
  const id=await inventory(5),issued=await send(op('issueStock',{store:'issuance',expectedVersion:0,payload:{invDocId:id,qty:3,issuedTo:'Test',date:'2026-10-16',inventoryVersion:2}}));
  assert.equal((await send(op('returnStock',{store:'issuance',docId:issued.docId,expectedVersion:1,payload:{qty:1,inventoryVersion:3}}))).error,'invalid-argument');
  const r=await send(op('returnStock',{store:'issuance',docId:issued.docId,expectedVersion:1,payload:{qty:1,inventoryVersion:3,confirmedReturn:true}}));assert.equal(r.status,'committed',JSON.stringify(r));
  assert.equal((await invRef(id).get()).data().qty,3);assert.equal((await issueRef(issued.docId).get()).data().qtyReturned,1);
  assert.equal((await send(op('returnStock',{store:'issuance',docId:issued.docId,expectedVersion:2,payload:{qty:3,inventoryVersion:4,confirmedReturn:true}}))).error,'failed-precondition');await reconcile(id);
});
test('manual amendments apply only net changes and require confirmed physical reductions',async()=>{
  const id=await inventory(10);let r=await send(op('issueStock',{store:'issuance',expectedVersion:0,payload:{invDocId:id,qty:2,issuedTo:'Test',date:'2026-10-16',inventoryVersion:2}}));
  const amend=async(qty,confirmedReturn=false)=>send(op('amendManualIssue',{store:'issuance',docId:r.docId,expectedVersion:r.version,payload:{qty,issuedTo:'Updated recipient',date:'2026-10-16',inventoryVersion:(await invRef(id).get()).data()._v,confirmedReturn}}));
  r=await amend(4);assert.equal(r.status,'committed');assert.equal((await invRef(id).get()).data().qty,6);
  assert.equal((await amend(1)).error,'invalid-argument');r=await amend(1,true);assert.equal(r.status,'committed');assert.equal((await invRef(id).get()).data().qty,9);await reconcile(id);
});
test('duplicate inventory selections cannot independently overspend stock',async()=>{
  const id=await inventory(5),r=await saveWO([material(id,3,'a'),material(id,3,'b')]);assert.equal(r.error,'failed-precondition');assert.equal((await invRef(id).get()).data().qty,5);await reconcile(id);
});
test('20 unchanged WO edits create zero additional movements or issuance rows',async()=>{
  const id=await inventory(10),lines=[material(id,2,'a'),material(id,1,'b')];let r=await saveWO(lines);assert.equal(r.status,'committed',JSON.stringify(r));
  for(let i=0;i<20;i++){r=await saveWO(lines,r);assert.equal(r.status,'committed',JSON.stringify(r));}
  assert.equal((await invRef(id).get()).data().qty,7);assert.equal((await reconcile(id)).length,2);
  const rows=(await service.db.collection('hammsStores/issuance/records').where('woDocId','==',r.docId).get()).docs.filter(d=>!d.data()._archived);assert.equal(rows.length,2);assert.deepEqual(rows.map(d=>d.data().qtyIssued).sort(),[1,2]);
});
test('WO increases deduct net delta and reductions require confirmed physical return',async()=>{
  const id=await inventory(10);let r=await saveWO([material(id,2)]);r=await saveWO([material(id,4)],r);assert.equal(r.status,'committed');assert.equal((await invRef(id).get()).data().qty,6);
  const denied=await saveWO([material(id,1)],r);assert.equal(denied.error,'invalid-argument');assert.equal((await invRef(id).get()).data().qty,6);
  r=await saveWO([material(id,1)],r,{confirmedReturn:true});assert.equal(r.status,'committed');assert.equal((await invRef(id).get()).data().qty,9);await reconcile(id);
});
test('WO cancellation never automatically restocks; explicit partial return does',async()=>{
  const id=await inventory(10);let r=await saveWO([material(id,4)]);
  r=await send(op('cancelWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{returns:[],inventoryVersions:await invVersions([id])}}));assert.equal(r.status,'committed',JSON.stringify(r));assert.equal((await invRef(id).get()).data().qty,6);
  assert.equal((await send(op('reopenWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{}}))).error,'permission-denied');
  r=await send(op('reopenWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{}}),'admin');assert.equal(r.status,'committed');
  r=await send(op('cancelWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{returns:[{lineId:'line-one',qty:2}],inventoryVersions:await invVersions([id]),confirmedReturn:true}}));assert.equal(r.status,'committed',JSON.stringify(r));assert.equal((await invRef(id).get()).data().qty,8);assert.equal((await woRef(r.docId).get()).data().materials[0].qty,2);await reconcile(id);
});
test('archive/restore preserve material accounting without double deduction',async()=>{
  const id=await inventory(5);let r=await saveWO([material(id,2)]);const original=r.docId;
  r=await send(op('archiveWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{}}));assert.equal(r.status,'committed');assert.equal((await woRef(original).get()).data()._archived,true);
  assert.equal((await send(op('restoreWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{}}))).error,'permission-denied');
  r=await send(op('restoreWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{}}),'admin');assert.equal(r.status,'committed');assert.equal((await invRef(id).get()).data().qty,3);assert.equal((await reconcile(id)).length,2);
});
test('last material removal archives its issuance and retains evidence',async()=>{
  const id=await inventory(2);let r=await saveWO([material(id,1)]);
  r=await send(op('saveWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{record:{remarks:'All returned'},materials:[],inventoryVersions:await invVersions([id]),confirmedReturn:true}}));assert.equal(r.status,'committed',JSON.stringify(r));
  const rows=(await service.db.collection('hammsStores/issuance/records').where('woDocId','==',r.docId).get()).docs;assert.equal(rows.length,1);assert.equal(rows[0].data()._archived,true);assert.equal((await invRef(id).get()).data().qty,2);await reconcile(id);
});
test('stale inventory version and missing reason reject before mutation',async()=>{
  const id=await inventory(5);assert.equal((await send(op('receiveStock',{store:'inventory',docId:id,expectedVersion:1,payload:{quantity:1}}))).error,'aborted');
  assert.equal((await send({...op('receiveStock',{store:'inventory',docId:id,expectedVersion:2,payload:{quantity:1}}),reason:''})).error,'invalid-argument');assert.equal((await invRef(id).get()).data().qty,5);
});
test('multi-item insufficiency rolls back every item, automatic line, WO and outcome',async()=>{
  const a=await inventory(10),b=await inventory(1);const r=await saveWO([material(a,2,'a'),material(b,2,'b')]);assert.equal(r.error,'failed-precondition');assert.equal((await invRef(a).get()).data().qty,10);assert.equal((await invRef(b).get()).data().qty,1);await reconcile(a);await reconcile(b);
});
test('corrupt automatic issuance and legacy material linkage fail closed',async()=>{
  const id=await inventory(5);let r=await saveWO([material(id,1)]);const ref=(await service.db.collection('hammsStores/issuance/records').where('woDocId','==',r.docId).get()).docs[0].ref;
  await ref.update({qtyIssued:2});const rejected=await saveWO([material(id,1)],r);assert.equal(rejected.error,'failed-precondition');assert.equal((await invRef(id).get()).data().qty,4);
  await woRef('legacy-materials').set({...fixtures.wo,id:700001,_docId:'legacy-materials',_v:1,materials:[{invId:1,qty:1}]});
  const legacy=await send(op('archiveWorkOrder',{store:'wo',docId:'legacy-materials',expectedVersion:1,payload:{}}));assert.equal(legacy.error,'failed-precondition');
});
test('retired material line IDs cannot be silently reused or reassigned',async()=>{
  const id=await inventory(5),other=await inventory(5);let r=await saveWO([material(id,1)]);
  const switched=await send(op('saveWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{record:{},materials:[material(other,1)],inventoryVersions:await invVersions([id,other]),confirmedReturn:true}}));assert.equal(switched.error,'invalid-argument');
  r=await send(op('saveWorkOrder',{store:'wo',docId:r.docId,expectedVersion:r.version,payload:{record:{},materials:[],inventoryVersions:await invVersions([id]),confirmedReturn:true}}));
  const reused=await saveWO([material(id,1)],r);assert.equal(reused.error,'failed-precondition');assert.equal((await invRef(id).get()).data().qty,5);
});
test('stale or unverified opening proposals cannot change ledger or balances',async()=>{
  const id='stale-proposal';await invRef(id).set({...fixtures.inventory,id:700002,_docId:id,_v:1,qty:4});const data=(await invRef(id).get()).data();
  for(const [suffix,patch]of [['unverified',{userVerified:false}],['stale',{expectedVersion:2}],['tampered',{recordHash:'wrong'}]]){
    const proposalId='proposal-'+suffix;await service.db.doc('correctionProposals/'+proposalId).set({type:'opening-balance',status:'approved',userVerified:true,approvedBy:'stock-admin',invDocId:id,expectedVersion:1,quantityUnits:40000,recordHash:sha(data),...patch});
    const r=await send(op('establishOpeningBalance',{store:'inventory',docId:id,expectedVersion:1,payload:{proposalId}}),'admin');assert.equal(r.error,'failed-precondition');
  }
  assert.equal((await service.db.doc('inventoryLedgers/'+id).get()).exists,false);assert.equal((await invRef(id).get()).data().qty,4);
});
test('legacy nonzero stock cannot initialize its own opening balance',async()=>{
  const id='legacy-opening';await invRef(id).set({...fixtures.inventory,id:500000,_docId:id,_v:1,qty:7});
  assert.equal((await send(op('receiveStock',{store:'inventory',docId:id,expectedVersion:1,payload:{quantity:1}}))).error,'failed-precondition');
  assert.equal((await send(op('establishOpeningBalance',{store:'inventory',docId:id,expectedVersion:1,payload:{proposalId:'missing'}}),'admin')).error,'failed-precondition');assert.equal((await invRef(id).get()).data().qty,7);
});
test('opening balance requires exact approved user-verified snapshot; preserves stock',async()=>{
  const id='reviewed-opening';await invRef(id).set({...fixtures.inventory,id:500001,_docId:id,_v:1,qty:7});const item=(await invRef(id).get()).data();
  await service.db.doc('correctionProposals/test-opening').set({type:'opening-balance',status:'approved',userVerified:true,approvedBy:'stock-admin',invDocId:id,expectedVersion:1,quantityUnits:70000,recordHash:sha(item)});
  const b=op('establishOpeningBalance',{store:'inventory',docId:id,expectedVersion:1,payload:{proposalId:'test-opening'}});
  assert.equal((await send(b)).error,'permission-denied');assert.equal((await send(b,'admin')).status,'committed');assert.equal((await invRef(id).get()).data().qty,7);await reconcile(id);
});
for(const kind of ['movement','issuance','audit'])test(`atomic rollback when ${kind} write fails`,async()=>{
  const id=await inventory(5),body=op('saveWorkOrder',{store:'wo',expectedVersion:0,payload:{record:fixtures.wo,materials:[material(id,2)],inventoryVersions:await invVersions([id])}});
  const key=sha({uid:'stock-staff',operationId:body.operationId}),wo='wo_'+key.slice(0,32);
  const path=kind==='movement'?'inventoryMovements/'+sha(key+'/'+id):kind==='issuance'?'hammsStores/issuance/records/auto_'+sha(wo+'/line-one').slice(0,40):'auditEvents/'+key;
  await service.db.doc(path).set({syntheticCollision:true});const r=await send(body);assert.ok(r.error);assert.equal((await woRef(wo).get()).exists,false);assert.equal((await invRef(id).get()).data().qty,5);assert.equal((await service.db.doc('operationResults/'+key).get()).exists,false);
});
test('rules deny immutable ledger/movement and proposal forgery to staff and admin',async()=>{
  const id=await inventory(1);const movement=(await service.db.collection('inventoryMovements').where('invDocId','==',id).get()).docs[0];
  for(const role of ['staff','admin'])for(const path of [movement.ref.path,'inventoryLedgers/'+id,'correctionProposals/forged']){
    await assertFails(setDoc(doc(clients[role],path),{forged:true}));await assertFails(updateDoc(doc(clients[role],path),{balanceUnits:999}));await assertFails(deleteDoc(doc(clients[role],path)));
  }
  await assertSucceeds(getDoc(doc(clients.staff,movement.ref.path)));await assertFails(getDoc(doc(clients.staff,'correctionProposals/test-opening')));
});
test('100 paired issuances near insufficient stock never overdraw',async()=>{
  for(let i=0;i<100;i++){
    const id=await inventory(1),body=()=>op('issueStock',{store:'issuance',expectedVersion:0,payload:{invDocId:id,qty:1,issuedTo:'Race',date:'2026-10-16',inventoryVersion:2}});
    const [a,b]=await Promise.all([send(body()),send(body())]);assert.equal([a,b].filter(r=>r.status==='committed').length,1);assert.equal([a,b].filter(r=>r.error==='aborted').length,1);assert.equal((await invRef(id).get()).data().qty,0);await reconcile(id);
  }
});
test('100 repeated receipt operation pairs apply exactly once',async()=>{
  for(let i=0;i<100;i++){
    const id=await inventory(0),body=op('receiveStock',{store:'inventory',docId:id,expectedVersion:1,payload:{quantity:0.1}});const [a,b]=await Promise.all([send(body),send(body)]);assert.deepEqual(a,b);assert.equal(a.status,'committed');assert.equal((await invRef(id).get()).data().qty,0.1);assert.equal((await reconcile(id)).length,1);
  }
});
