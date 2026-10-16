import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc} from 'firebase/firestore';
import {createSecurityService,SECURITY_PROJECT} from '../security/service.mjs';
import {sha} from '../scripts/recovery-core.mjs';
import {assetHistory,roomHistory} from '../security/relationship-domain.mjs';
let env,service;const tokens={},clients={};
const op=(command,extra={})=>({command,operationId:crypto.randomUUID(),reason:'Synthetic relationship verification',...extra});
async function send(body,who='admin'){try{return await service.execute(tokens[who],body);}catch(e){return {error:e.code,message:e.message};}}
const ref=(store,id)=>service.db.doc(`hammsStores/${store}/records/${id}`);
async function createAsset(locationId='rsa',extra={}){const loc=(await service.db.doc('locations/'+locationId).get()).data();const r=await send(op('createRecord',{store:'assets',expectedVersion:0,payload:{name:'Shared lighting',section:'Electrical',location:loc.name,locationId,assetCode:'TEST-'+crypto.randomUUID(),...extra}}),'staff');assert.equal(r.status,'committed',JSON.stringify(r));return (await ref('assets',r.docId).get()).data();}
async function createWO(a,extra={}){return send(op('saveWorkOrder',{store:'wo',expectedVersion:0,payload:{record:{section:'Electrical',description:'Synthetic documented repair',status:'Open',priority:'High',workScope:a?'asset':'room',locationId:a?.locationId||'rsa',...(a?{assetDocId:a._docId,asset:a.name}:{}),...extra},materials:[],inventoryVersions:{}}}),'staff');}
async function legacy(){const id='legacy-'+crypto.randomUUID();await ref('wo',id).set({_docId:id,_v:1,id:1234567,section:'Electrical',description:'Actual synthetic repair evidence',status:'Closed',priority:'High',asset:'Unverified lighting',location:'DIETARY RSA',extraLegacy:{retain:[1,'typed']}});return id;}
async function propose(id,a,store='wo'){const record=(await ref(store,id).get()).data();return send(op('proposeRelationship',{store,docId:id,expectedVersion:record._v,payload:{patch:store==='wo'?{workScope:a?'asset':'room',locationId:a?.locationId||'rsa',...(a?{assetDocId:a._docId}:{})}:{locationId:a},evidence:'Synthetic source sheet verified against exact item',ownerUid:'phase5-admin'}}));}
async function approve(p,store='wo'){return send(op('approveRelationship',{store,docId:p.proposalId,expectedVersion:1,payload:{userVerified:true,verificationReference:'SYNTHETIC user approval for this preview'}}));}
async function apply(p,store='wo'){return send(op('applyRelationship',{store,docId:p.proposalId,expectedVersion:2,payload:{}}));}
before(async()=>{
  env=await initializeTestEnvironment({projectId:SECURITY_PROJECT,firestore:{host:'127.0.0.1',port:8186,rules:await fs.readFile('security/firestore.phase2.rules','utf8')}});await env.clearFirestore();service=await createSecurityService();
  await service.db.doc('system/writePolicy').set({maintenance:false});
  for(const role of ['admin','staff']){const uid='phase5-'+role,email=uid+'@example.test';await service.auth.createUser({uid,email,password:'Synthetic-Only-123!'});await service.db.doc('staff/'+uid).set({active:true,role,facilityId:'dopmc'});const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Synthetic-Only-123!',returnSecureToken:true})});tokens[role]=(await r.json()).idToken;clients[role]=env.authenticatedContext(uid,{email}).firestore();}
  for(const [id,name]of [['rsa','DIETARY RSA'],['kitchen','DIETARY KITCHEN'],['dietary','DIETARY']]){const r=await send(op('createLocation',{store:'assets',docId:id,expectedVersion:0,payload:{name,aliases:[]}}));assert.equal(r.status,'committed',JSON.stringify(r));}
});
after(async()=>{await service?.close();await env?.cleanup();});

test('locations support verified aliases and parents without alias collisions or cycles',async()=>{
  const make=(id,payload)=>send(op('createLocation',{store:'assets',docId:id,expectedVersion:0,payload}));
  assert.equal((await make('icu',{name:'ICU',aliases:['Intensive Care Unit'],aliasesVerified:true,verificationReference:'Synthetic verified alias',parentId:'rsa'})).status,'committed');
  assert.equal((await make('collision',{name:'Different',aliases:['ICU'],aliasesVerified:true,verificationReference:'Synthetic'})).error,'already-exists');
  assert.equal((await make('unverified',{name:'Unverified',aliases:['Unknown alias']})).error,'invalid-argument');
  assert.equal((await make('self',{name:'Self',aliases:[],parentId:'self'})).error,'invalid-argument');
  assert.equal((await make('rsa',{name:'Changed',aliases:[]})).error,'already-exists');
});
test('new equipment WOs require exact active asset, matching section and matching location',async()=>{
  const a=await createAsset();assert.equal((await createWO(a)).status,'committed');
  for(const patch of [{section:'Plumbing'},{locationId:'kitchen'},{assetDocId:'missing'},{asset:'Different display'}])assert.equal((await createWO(a,patch)).error,'invalid-argument');
  assert.equal((await createWO(null,{assetDocId:a._docId})).error,'invalid-argument');
  assert.equal((await createWO(null,{workScope:undefined})).error,'invalid-argument');
});
test('asset identity and room scope exclude identical names and general plumbing work',async()=>{
  const a=await createAsset(),b=await createAsset();const w=await createWO(a),room=await createWO(null,{section:'Plumbing',description:'General plumbing, not lighting'});assert.equal(room.status,'committed');
  const data=await service.inspect(tokens.staff,{load:true});assert.equal(assetHistory(a._docId,data.stores.wo,data.stores.assets,data.locations).records.some(r=>r._docId===w.docId),true);assert.equal(assetHistory(b._docId,data.stores.wo,data.stores.assets,data.locations).records.length,0);assert.equal(roomHistory('kitchen',data.stores.wo,data.stores.assets,data.locations).records.length,0);
});
test('ordinary edits cannot relink WOs or move/reclassify assets',async()=>{
  const a=await createAsset(),b=await createAsset(),w=await createWO(a);
  assert.equal((await send(op('updateRecord',{store:'wo',docId:w.docId,expectedVersion:1,payload:{assetDocId:b._docId}}),'staff')).error,'failed-precondition');
  for(const payload of [{locationId:'kitchen'},{location:'DIETARY KITCHEN'},{section:'Plumbing'},{assetClass:'Changed class'},{roomNumber:'New room'}])assert.equal((await send(op('updateRecord',{store:'assets',docId:a._docId,expectedVersion:1,payload}),'staff')).error,'failed-precondition');
});
test('renaming an asset preserves all exact history without rewriting WO snapshots',async()=>{
  const a=await createAsset(),w=await createWO(a);await ref('assets',a._docId).update({department:'Historical legacy label'});assert.equal((await send(op('updateRecord',{store:'assets',docId:a._docId,expectedVersion:1,payload:{name:'Renamed equipment'}}),'staff')).status,'committed');assert.equal((await ref('assets',a._docId).get()).data().department,'Historical legacy label');
  const data=await service.inspect(tokens.staff,{load:true});assert.equal(assetHistory(a._docId,data.stores.wo,data.stores.assets,data.locations).records.filter(r=>r._docId===w.docId).length,1);assert.equal((await ref('wo',w.docId).get()).data().asset,a.name);
});
test('duplicate asset codes cannot be registered concurrently or reused after archival',async()=>{
  const code='DUP-'+crypto.randomUUID(),payload={name:'Test',section:'Electrical',locationId:'rsa',location:'DIETARY RSA',assetCode:code};const [a,b]=await Promise.all([send(op('createRecord',{store:'assets',expectedVersion:0,payload}),'staff'),send(op('createRecord',{store:'assets',expectedVersion:0,payload}),'staff')]);assert.equal([a,b].filter(r=>r.status==='committed').length,1);assert.equal([a,b].filter(r=>r.error==='already-exists').length,1);
  const win=a.docId?a:b;await send(op('archiveRecord',{store:'assets',docId:win.docId,expectedVersion:1}),'staff');assert.equal((await send(op('createRecord',{store:'assets',expectedVersion:0,payload:{...payload,assetCode:code.toLowerCase()}}),'staff')).error,'already-exists');
});
test('legacy links require preview, explicit user verification and administrator approval',async()=>{
  const id=await legacy(),a=await createAsset(),before=(await ref('wo',id).get()).data(),p=await propose(id,a);assert.equal(p.status,'committed',JSON.stringify(p));assert.deepEqual((await ref('wo',id).get()).data(),before);
  assert.equal((await apply(p)).error,'aborted');assert.equal((await send(op('approveRelationship',{store:'wo',docId:p.proposalId,expectedVersion:1,payload:{userVerified:false,verificationReference:'No approval'}}))).error,'failed-precondition');
  assert.equal((await approve(p)).status,'committed');assert.equal((await apply(p)).status,'committed');const after=(await ref('wo',id).get()).data();assert.equal(after.assetDocId,a._docId);assert.equal(after._docId,id);assert.equal(after.id,before.id);assert.deepEqual(after.extraLegacy,before.extraLegacy);assert.equal(after._v,2);
});
test('general room classification does not invent an equipment repair',async()=>{const id=await legacy(),p=await propose(id,null);await approve(p);assert.equal((await apply(p)).status,'committed');const r=(await ref('wo',id).get()).data();assert.equal(r.workScope,'room');assert.equal(r.assetDocId,null);});
for(const who of ['target','asset','location'])test(`stale ${who} dependency invalidates an approved preview`,async()=>{
  const id=await legacy(),a=await createAsset(),p=await propose(id,a);await approve(p);
  const r=who==='target'?ref('wo',id):who==='asset'?ref('assets',a._docId):service.db.doc('locations/rsa');const old=(await r.get()).data();await r.update({syntheticChanged:crypto.randomUUID()});assert.equal((await apply(p)).error,'aborted');assert.equal((await ref('wo',id).get()).data().assetDocId,undefined);if(who==='location')await r.set(old);
});
test('staff cannot propose, approve, apply or create locations through trusted commands',async()=>{
  for(const command of ['proposeRelationship','approveRelationship','applyRelationship','createLocation'])assert.equal((await send(op(command,{store:'wo',docId:'any',expectedVersion:1,payload:{}}),'staff')).error,'permission-denied');
});
test('client writes to locations, approval artifacts and code reservations are denied',async()=>{
  for(const role of ['staff','admin'])for(const path of ['locations/rsa','relationshipProposals/forged','assetCodes/forged']){await assertFails(setDoc(doc(clients[role],path),{userVerified:true,status:'approved'}));await assertFails(updateDoc(doc(clients[role],path),{name:'Tampered'}));await assertFails(deleteDoc(doc(clients[role],path)));}
  await assertSucceeds(getDoc(doc(clients.staff,'locations/rsa')));await assertFails(getDoc(doc(clients.staff,'relationshipProposals/forged')));
});
test('failed audit write rolls back approved relationship application completely',async()=>{
  const id=await legacy(),p=await propose(id,await createAsset());await approve(p);const b=op('applyRelationship',{store:'wo',docId:p.proposalId,expectedVersion:2,payload:{}});await service.db.doc('auditEvents/'+sha({uid:'phase5-admin',operationId:b.operationId})).set({syntheticCollision:true});assert.ok((await send(b)).error);assert.equal((await ref('wo',id).get()).data().assetDocId,undefined);assert.equal((await service.db.doc('relationshipProposals/'+p.proposalId).get()).data().status,'approved');
});
test('repeated approved application changes identity once and records one audit outcome',async()=>{
  const id=await legacy(),p=await propose(id,await createAsset());await approve(p);const b=op('applyRelationship',{store:'wo',docId:p.proposalId,expectedVersion:2,payload:{}});const [a,c]=await Promise.all([send(b),send(b)]);assert.equal(a.status,'committed');assert.deepEqual(a,c);assert.equal((await ref('wo',id).get()).data()._v,2);
});
test('asset archival preserves references and history but prevents new equipment work',async()=>{
  const a=await createAsset(),w=await createWO(a);assert.equal((await send(op('archiveRecord',{store:'assets',docId:a._docId,expectedVersion:1}),'staff')).status,'committed');assert.equal((await createWO(a)).error,'invalid-argument');const data=await service.inspect(tokens.staff,{load:true});assert.equal(assetHistory(a._docId,data.stores.wo,data.stores.assets,data.locations).records.some(r=>r._docId===w.docId),true);
});
test('approved asset move preserves historical room snapshots and future WOs use the new room',async()=>{
  const a=await createAsset(),w=await createWO(a),p=await propose(a._docId,'kitchen','assets');assert.equal(p.status,'committed');await approve(p,'assets');assert.equal((await apply(p,'assets')).status,'committed');assert.equal((await ref('wo',w.docId).get()).data().locationId,'rsa');const moved=(await ref('assets',a._docId).get()).data();assert.equal(moved.locationId,'kitchen');assert.equal((await createWO(moved)).status,'committed');assert.equal((await createWO(a)).error,'invalid-argument');
});
test('all newly managed work orders have explicit scope and zero dangling relationships',async()=>{
  const data=await service.inspect(tokens.staff,{load:true}),managed=data.stores.wo.filter(w=>w._stockManaged===true);let equipment=0,room=0;
  assert.ok(managed.length>0);for(const w of managed){assert.ok(data.locations.some(l=>l.docId===w.locationId));if(w.workScope==='asset'){equipment++;const a=data.stores.assets.find(a=>a._docId===w.assetDocId);assert.ok(a);assert.equal(w.section,a.section);assert.ok(assetHistory(a._docId,[w],data.stores.assets,data.locations,{includeArchived:true}).records.length===1);}else{room++;assert.equal(w.workScope,'room');assert.ok(!w.assetDocId);}}
  console.log('PHASE5_RELATIONSHIP_METRICS '+JSON.stringify({newWorkOrders:managed.length,equipment,room,explicitScopePercent:100,danglingReferences:0}));
});
