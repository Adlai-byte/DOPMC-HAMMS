import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {createLocalHarness} from '../scripts/phase3-local-server.mjs';
import {fixtures} from './phase2-fixtures.mjs';
import {bootstrapApp} from './helpers/emulator-bootstrap.mjs';
let harness,base,browser,token;
const op=(command,extra)=>({command,operationId:crypto.randomUUID(),reason:'Synthetic browser setup',...extra});
before(async()=>{
  harness=await createLocalHarness();base=await harness.listen();const {db,auth}=harness.service;
  await auth.createUser({uid:'stock-ui-user',email:'stock-ui-user@example.test',password:'Synthetic-Only-123!'});await db.doc('staff/stock-ui-user').set({active:true,role:'staff',facilityId:'dopmc'});await db.doc('system/writePolicy').set({maintenance:false});await db.doc('locations/test-room').set({name:'Test room'});
  const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'stock-ui-user@example.test',password:'Synthetic-Only-123!',returnSecureToken:true})});token=(await r.json()).idToken;browser=await chromium.launch();
});
after(async()=>{await browser?.close();await harness?.close();});
async function item(qty=0){const r=await harness.service.execute(token,op('createRecord',{store:'inventory',expectedVersion:0,payload:{...fixtures.inventory,description:'Synthetic browser stock '+crypto.randomUUID()}}));if(qty)await harness.service.execute(token,op('receiveStock',{store:'inventory',docId:r.docId,expectedVersion:1,payload:{quantity:qty}}));return r.docId;}
async function page(){const p=await browser.newPage();await p.route(/https:\/\/(firestore|identitytoolkit|securetoken)\.googleapis\.com\//,r=>r.abort());await bootstrapApp(p,base,'stock-ui-user@example.test');return p;}
async function balance(p,id,qty){await p.waitForFunction(({id,qty})=>DB.g('inventory').find(i=>i._docId===id)?.qty===qty,{id,qty});}
test('browser receipts and signed adjustments require reasons and refresh acknowledged stock',async()=>{
  const id=await item(),p=await page();await p.evaluate(id=>{navigate('inventory');HAMMS_PHASE4.openMovement('receiveStock',id);},id);await p.locator('#stock-quantity').fill('5.125');
  let writes=0;p.on('request',r=>{if(r.url().endsWith('/api/commands'))writes++;});await p.locator('#stock-movement-form button[type=submit]').click();assert.equal(writes,0);
  await p.locator('#stock-reason').fill('Synthetic delivery received');await p.locator('#stock-reference').fill('DEMO-DELIVERY');await p.locator('#stock-movement-form button[type=submit]').click();await balance(p,id,5.125);
  await p.evaluate(id=>HAMMS_PHASE4.openMovement('adjustStock',id),id);await p.locator('#stock-quantity').fill('-0.125');await p.locator('#stock-reason').fill('Synthetic count reconciliation');await p.locator('#stock-movement-form button[type=submit]').click();await balance(p,id,5);
  await p.getByRole('button',{name:'Review movement ledger',exact:true}).click();await p.waitForFunction(()=>document.getElementById('phase4-ledger').textContent.includes('Synthetic count reconciliation'));await p.close();
});
test('browser manual issuance and confirmed partial return are accounted once',async()=>{
  const id=await item(10),p=await page();await p.evaluate(id=>{navigate('issuance');const item=DB.g('inventory').find(i=>i._docId===id);openIssueModalFor(item.id);},id);
  await p.locator('#m-iss-qty').fill('2');await p.locator('#m-iss-to').fill('Synthetic recipient');await p.locator('#m-iss-remarks').fill('Synthetic manual use');await p.evaluate(()=>saveManualIssue());await balance(p,id,8);
  const issued=await p.evaluate(id=>DB.g('issuance').find(r=>r.invDocId===id&&r.source==='manual')._docId,id);
  await p.evaluate(id=>{navigate('inventory');HAMMS_PHASE4.openMovement('returnStock',id);},issued);await p.locator('#stock-quantity').fill('1');await p.locator('#stock-reason').fill('Synthetic unused material returned');await p.locator('#stock-movement-form button[type=submit]').click();assert.equal(await p.locator('#mo-stock-movement').isVisible(),true);
  await p.locator('#stock-physical').check();await p.locator('#stock-movement-form button[type=submit]').click();await balance(p,id,9);await p.close();
});
test('browser WO material edits preserve line identity and do not duplicate issuance',async()=>{
  const id=await item(10),p=await page();await p.evaluate(id=>{
    navigate('workorders');openWOModal();document.getElementById('m-wo-section').value='Electrical';document.getElementById('m-wo-asset').value='__room_general__';document.getElementById('m-wo-loc').value='Test room';document.getElementById('m-wo-desc').value='Synthetic material WO';
    const item=DB.g('inventory').find(i=>i._docId===id);_woMaterials=[{invId:item.id,qty:2,issuedTo:'Synthetic worker'}];renderMaterialRows();
  },id);await p.evaluate(()=>saveWO());await balance(p,id,8);
  const wo=await p.evaluate(()=>DB.g('wo').find(w=>w.description==='Synthetic material WO'));const line=wo.materials[0].lineId;
  for(let i=0;i<3;i++){await p.evaluate(id=>openWOModal(DB.g('wo').find(w=>w._docId===id).id),wo._docId);await p.evaluate(()=>saveWO());}
  assert.equal(await p.evaluate(id=>DB.g('inventory').find(i=>i._docId===id).qty,id),8);assert.equal(await p.evaluate(id=>DB.g('issuance').filter(r=>r.woDocId===id).length,wo._docId),1);
  await p.evaluate(id=>{openWOModal(DB.g('wo').find(w=>w._docId===id).id);_woMaterials[0].qty=1;document.getElementById('m-wo-remarks').value='Unused material physically returned';renderMaterialRows();},wo._docId);
  await p.evaluate(()=>saveWO());await balance(p,id,9);assert.equal(await p.evaluate(id=>DB.g('wo').find(w=>w._docId===id).materials[0].lineId,wo._docId),line);await p.close();
});
test('browser lost receipt response reconciles stock and ledger without a second receipt',async()=>{
  const id=await item(),p=await page();await p.evaluate(id=>{navigate('inventory');HAMMS_PHASE4.openMovement('receiveStock',id);},id);await p.locator('#stock-quantity').fill('3');await p.locator('#stock-reason').fill('Synthetic uncertain receipt');
  let writes=0;await p.route('**/api/commands',async route=>{writes++;await route.fetch();await route.abort();});await p.locator('#stock-movement-form button[type=submit]').click();await p.waitForFunction(()=>HAMMS_PHASE3.controller.snapshot.state==='outcome-unknown');
  await p.getByRole('button',{name:'Check save status',exact:true}).click();await balance(p,id,3);assert.equal(writes,1);assert.equal((await harness.service.db.collection('inventoryMovements').where('invDocId','==',id).get()).size,1);await p.close();
});

test('manual amendment shows returned and net quantities without duplicate deduction',async()=>{
  const id=await item(10),p=await page();await p.evaluate(id=>{navigate('issuance');openIssueModalFor(DB.g('inventory').find(i=>i._docId===id).id);},id);
  await p.locator('#m-iss-qty').fill('3');await p.locator('#m-iss-to').fill('Synthetic recipient');await p.locator('#m-iss-section').selectOption('Electrical');await p.locator('#m-iss-wo').fill('Synthetic display reference');await p.locator('#m-iss-remarks').fill('Synthetic use');await p.evaluate(()=>saveManualIssue());await balance(p,id,7);
  assert.equal(await p.evaluate(id=>DB.g('issuance').find(r=>r.invDocId===id).section,id),'Electrical');assert.equal(await p.locator('#issue-tbody button').filter({hasText:'Edit'}).count()>0,true);
  await p.evaluate(id=>openIssueEditModal(DB.g('issuance').find(r=>r.invDocId===id).id),id);await p.locator('#m-iss-qty').fill('2');await p.locator('#m-iss-remarks').fill('One unused item physically returned');await p.evaluate(()=>saveIssuanceEdit());await balance(p,id,8);
  const issued=await p.evaluate(id=>DB.g('issuance').find(r=>r.invDocId===id)._docId,id);await p.evaluate(id=>HAMMS_PHASE4.openMovement('returnStock',id),issued);await p.locator('#stock-quantity').fill('1');await p.locator('#stock-reason').fill('Another unused item physically returned');await p.locator('#stock-physical').check();await p.locator('#stock-movement-form button[type=submit]').click();await balance(p,id,9);
  await p.evaluate(()=>navigate('issuance'));assert.match(await p.locator('#issue-tbody').textContent(),/Returned: 1 · Net: 1/);await p.close();
});

test('cancellation form keeps consumed stock and excludes cancelled work from overdue',async()=>{
  const id=await item(10);const created=await harness.service.execute(token,op('saveWorkOrder',{store:'wo',expectedVersion:0,payload:{record:{...fixtures.wo,targetCompletionDate:'2020-01-01'},materials:[{lineId:'ui-cancel',invDocId:id,qty:2,issuedTo:'Synthetic worker'}],inventoryVersions:{[id]:2}}}));assert.equal(created.status,'committed');
  const p=await page();await p.evaluate(()=>{navigate('inventory');HAMMS_PHASE4.openWorkOrder();});await p.locator('#stock-wo-record').selectOption(created.docId);await p.locator('#stock-wo-reason').fill('Synthetic cancellation; materials already consumed');await p.locator('#stock-wo-form button[type=submit]').click();
  await p.waitForFunction(id=>DB.g('wo').find(w=>w._docId===id)?.status==='Cancelled',created.docId);await balance(p,id,8);assert.equal(await p.evaluate(id=>Boolean(overdue(DB.g('wo').find(w=>w._docId===id))),created.docId),false);await p.close();
});

test('typing during pending manual issue continues as an amendment of the acknowledged record',async()=>{
  const id=await item(10),p=await page();await p.evaluate(id=>{navigate('issuance');openIssueModalFor(DB.g('inventory').find(i=>i._docId===id).id);},id);
  await p.locator('#m-iss-qty').fill('2');await p.locator('#m-iss-to').fill('Synthetic recipient');await p.locator('#m-iss-remarks').fill('Synthetic issue');
  let release;const held=new Promise(resolve=>{release=resolve;});await p.route('**/api/commands',async route=>{await held;await route.continue();});
  const pending=p.evaluate(()=>saveManualIssue());await p.waitForFunction(()=>HAMMS_PHASE3.controller.snapshot.busy);await p.locator('#m-iss-qty').fill('3');release();await pending;await balance(p,id,8);await p.unroute('**/api/commands');
  assert.equal(await p.locator('#mo-issue').isVisible(),true);assert.equal(await p.locator('#m-iss-qty').inputValue(),'3');await p.locator('#btn-iss-save').click();await balance(p,id,7);
  assert.equal(await p.evaluate(id=>DB.g('issuance').filter(r=>r.invDocId===id).length,id),1);await p.close();
});
test('browser stock controls and ledger clear at sign-out and fit mobile',async()=>{
  const id=await item(),p=await page();await p.setViewportSize({width:390,height:844});await p.evaluate(id=>{navigate('inventory');HAMMS_PHASE4.openMovement('receiveStock',id);},id);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await fs.mkdir('test-results/phase4',{recursive:true});await p.screenshot({path:'test-results/phase4/stock-mobile.png'});
  await p.evaluate(()=>{document.getElementById('phase4-ledger').textContent='Synthetic private ledger';HAMMS_PHASE3.signOut();});assert.equal(await p.locator('#phase4-ledger').textContent(),'');assert.deepEqual(await p.evaluate(()=>window._phase4AllWO),[]);await p.close();
});
