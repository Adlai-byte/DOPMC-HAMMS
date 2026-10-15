import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {createLocalHarness} from '../scripts/phase3-local-server.mjs';
import {STORES} from '../scripts/recovery-core.mjs';
import {fixtures} from './phase2-fixtures.mjs';

let harness,base,browser;
const tokens={};
before(async()=>{
  harness=await createLocalHarness();base=await harness.listen();const {db,auth}=harness.service;
  for(const [uid,role]of [['staff','staff'],['admin','admin']]) {
    try{await auth.createUser({uid,email:uid+'@example.test',password:'Synthetic-Only-123!'});}catch(e){if(e.code!=='auth/uid-already-exists')throw e;}
    await db.doc('staff/'+uid).set({role,active:true,facilityId:'dopmc'});
    const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:uid+'@example.test',password:'Synthetic-Only-123!',returnSecureToken:true})});tokens[uid]=(await r.json()).idToken;
  }
  await db.doc('system/writePolicy').set({maintenance:false});await db.doc('locations/test-room').set({name:'Test room'});
  browser=await chromium.launch();
});
after(async()=>{await browser?.close();await harness?.close();});

// Reuse the existing CRUD bootstrap sequence, with explicit emulator sign-in instead of a fake cloud session.
async function bootstrapApp(page){
  await page.goto(base+'/?nocache='+Date.now());
  await page.evaluate(async()=>{if(navigator.serviceWorker)for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);});
  await page.goto(base+'/?nocache='+Date.now());await page.waitForLoadState('networkidle');
  await page.waitForFunction(()=>window.HAMMS_PHASE3?.ready);
  await page.evaluate(()=>{
    document.getElementById('hamms-login-overlay').style.cssText='display:none!important';document.getElementById('app').style.visibility='visible';
    const stores=['wo','assets','inventory','issuance','waste','waterLogs','waterTank','effluent','safety','projects','medWasteProd','wwProd','censusLog','waterSettings','energyBills'];
    stores.forEach(s=>{if(!_memDB[s])_memDB[s]=[];});
    Object.keys(_fbPendingStoreOps).forEach(k=>delete _fbPendingStoreOps[k]);window._FB={enabled:false};window.confirmDialog=async()=>true;
  });
  await page.evaluate(()=>HAMMS_PHASE3.signIn('staff@example.test','Synthetic-Only-123!'));
}
async function newPage(){const p=await browser.newPage();await p.route(/https:\/\/(firestore|identitytoolkit|securetoken)\.googleapis\.com\//,r=>{throw Error('Cloud access forbidden: '+r.request().url());});await bootstrapApp(p);return p;}
async function fillSafety(p,text){await p.evaluate(()=>{navigate('safety');openSafetyModal();});await p.locator('#m-sf-desc').fill(text);await p.locator('#m-sf-sev').selectOption('Low');}
async function send(actor,body){const r=await fetch(base+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[actor]},body:JSON.stringify(body)});return {http:r.status,...await r.json()};}
const op=(command,extra)=>({command,operationId:crypto.randomUUID(),reason:'Synthetic phase3 verification',...extra});

test('browser: login form authenticates against emulator and shows server-verified Live',async()=>{
  const p=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base);await p.waitForFunction(()=>window.HAMMS_PHASE3?.ready);await p.waitForLoadState('networkidle');
  await p.locator('#login-email').fill('staff@example.test');await p.locator('#login-password').fill('Synthetic-Only-123!');await p.locator('#login-btn').click();
  await p.waitForFunction(()=>window.HAMMS_PHASE3.controller.snapshot.state==='live');assert.equal(await p.locator('#hamms-login-overlay').isVisible(),false);assert.deepEqual(errors,[]);await p.close();
});
test('browser: delayed save leaves form/data unchanged until server acknowledgement',async()=>{
  const p=await newPage();await fillSafety(p,'Delayed synthetic save');
  const initial=await p.evaluate(()=>DB.g('safety').length);let release;
  await p.route('**/api/commands',async route=>{await new Promise(r=>release=r);await route.continue();});
  const save=p.evaluate(()=>saveSafety());await p.waitForFunction(()=>HAMMS_PHASE3.controller.snapshot.state==='saving');
  assert.equal(await p.locator('#mo-safety').isVisible(),true);assert.equal(await p.locator('#m-sf-desc').inputValue(),'Delayed synthetic save');assert.equal(await p.evaluate(()=>DB.g('safety').length),initial);
  await p.evaluate(()=>saveSafety());release();await save;
  assert.equal(await p.locator('#mo-safety').isVisible(),false);assert.equal(await p.evaluate(()=>DB.g('safety').length),initial+1);await p.close();
});
test('browser: offline retains draft and reconnect never replays rejected save',async()=>{
  const p=await newPage();await fillSafety(p,'Offline draft');let writes=0;p.on('request',r=>{if(r.url().endsWith('/api/commands'))writes++;});
  await p.context().setOffline(true);await p.evaluate(()=>saveSafety());assert.equal(await p.locator('#m-sf-desc').inputValue(),'Offline draft');assert.equal(await p.locator('#mo-safety').isVisible(),true);
  await p.context().setOffline(false);await p.evaluate(()=>HAMMS_PHASE3.controller.probe());assert.equal(writes,0);assert.equal(await p.locator('#m-sf-desc').inputValue(),'Offline draft');await p.close();
});
test('browser: permission rejection preserves form, attachments and source state',async()=>{
  const p=await newPage();await fillSafety(p,'Permission failure draft');const previous=await p.evaluate(()=>JSON.stringify(_memDB));
  await p.evaluate(()=>document._woReport='data:image/png;base64,TEST');
  await p.route('**/api/commands',r=>r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'permission-denied',message:'Synthetic denial'}})}));
  await p.evaluate(()=>saveSafety());assert.equal(await p.locator('#mo-safety').isVisible(),true);assert.equal(await p.locator('#m-sf-desc').inputValue(),'Permission failure draft');
  assert.equal(await p.evaluate(()=>document._woReport),'data:image/png;base64,TEST');assert.equal(await p.evaluate(()=>JSON.stringify(_memDB)),previous);assert.equal(await p.locator('#storage-chip').textContent(),'Unavailable');await p.close();
});
test('browser: committed write with lost response is reconciled without a duplicate',async()=>{
  const p=await newPage();await fillSafety(p,'Lost response synthetic');let writes=0;
  await p.route('**/api/commands',async route=>{writes++;await route.fetch();await route.abort('failed');});
  await p.evaluate(()=>saveSafety());assert.equal(await p.evaluate(()=>HAMMS_PHASE3.controller.snapshot.state),'outcome-unknown');assert.equal(await p.locator('#mo-safety').isVisible(),true);
  await p.locator('button').filter({hasText:/^Check save status$/}).click();await p.waitForFunction(()=>HAMMS_PHASE3.controller.snapshot.state==='live');
  assert.equal(writes,1);await p.waitForFunction(()=>!document.getElementById('mo-safety').classList.contains('open'));assert.equal((await harness.service.db.collection('hammsStores/safety/records').where('description','==','Lost response synthetic').get()).size,1);await p.close();
});
test('browser: stale edit retains draft and latest-record review does not overwrite it',async()=>{
  const r=await send('staff',op('createRecord',{store:'safety',expectedVersion:0,payload:fixtures.safety}));assert.equal(r.http,200);
  const p=await newPage();await p.evaluate(docId=>{const s=DB.g('safety').find(s=>s._docId===docId);navigate('safety');openSafetyModal(s.id);},r.docId);await p.locator('#m-sf-desc').fill('My unsaved conflict draft');
  assert.equal((await send('staff',op('updateRecord',{store:'safety',docId:r.docId,expectedVersion:1,payload:{description:'Another staff update'}}))).http,200);
  await p.evaluate(()=>saveSafety());assert.equal(await p.evaluate(()=>HAMMS_PHASE3.controller.snapshot.state),'conflict');assert.equal(await p.locator('#m-sf-desc').inputValue(),'My unsaved conflict draft');
  await p.locator('button').filter({hasText:/^Review latest record$/}).click();await p.waitForFunction(()=>document.getElementById('phase3-latest')?.textContent.includes('Another staff update'));
  assert.equal(await p.locator('#m-sf-desc').inputValue(),'My unsaved conflict draft');
  await p.locator('button').filter({hasText:/^Use reviewed version for retry$/}).click();await p.evaluate(()=>saveSafety());
  assert.equal((await harness.service.db.doc('hammsStores/safety/records/'+r.docId).get()).data().description,'My unsaved conflict draft');await p.close();
});
test('browser: typing while a create is pending retains changes as an edit of the confirmed record',async()=>{
  const p=await newPage();await fillSafety(p,'Submitted snapshot');let release;
  await p.route('**/api/commands',async route=>{await new Promise(r=>release=r);await route.continue();});
  const first=p.evaluate(()=>saveSafety());await p.waitForFunction(()=>HAMMS_PHASE3.controller.snapshot.state==='saving');await p.locator('#m-sf-desc').fill('Changed while saving');release();await first;
  assert.equal(await p.locator('#mo-safety').isVisible(),true);assert.equal(await p.locator('#m-sf-desc').inputValue(),'Changed while saving');await p.unroute('**/api/commands');
  const id=await p.evaluate(()=>_editSafety);assert.ok(id);await p.evaluate(()=>saveSafety());
  const matching=await harness.service.db.collection('hammsStores/safety/records').where('id','==',id).get();assert.equal(matching.size,1);assert.equal(matching.docs[0].data()._v,2);assert.equal(matching.docs[0].data().description,'Changed while saving');await p.close();
});
test('browser: reload reconciles an uncertain operation using identity only',async()=>{
  const p=await newPage();await fillSafety(p,'Reload-safe uncertain save');
  await p.route('**/api/commands',async route=>{await route.fetch();await route.abort();});await p.evaluate(()=>saveSafety());
  assert.equal(await p.evaluate(()=>HAMMS_PHASE3.controller.snapshot.state),'outcome-unknown');
  const journal=await p.evaluate(()=>Object.values(sessionStorage));assert.equal(journal.some(v=>v.includes('Reload-safe uncertain save')),false);
  await p.unroute('**/api/commands');await p.reload();await p.waitForFunction(()=>window.HAMMS_PHASE3?.ready);await p.evaluate(()=>HAMMS_PHASE3.signIn('staff@example.test','Synthetic-Only-123!'));
  assert.equal(await p.evaluate(()=>HAMMS_PHASE3.controller.snapshot.state),'outcome-unknown');await p.evaluate(()=>HAMMS_PHASE3.reconcile());
  assert.equal(await p.evaluate(()=>HAMMS_PHASE3.controller.snapshot.pending),null);assert.equal((await harness.service.db.collection('hammsStores/safety/records').where('description','==','Reload-safe uncertain save').get()).size,1);await p.close();
});
test('browser: stock and import paths cannot fall back to legacy cloud writes',async()=>{
  const p=await newPage();await p.evaluate(()=>{navigate('inventory');openInvModal();});await p.locator('#m-i-desc').fill('Forbidden initial balance');await p.locator('#m-i-cat').selectOption('Electrical');await p.locator('#m-i-qty').fill('10');
  await p.evaluate(()=>saveInvItem());assert.equal(await p.locator('#mo-inv').isVisible(),true);assert.equal(await p.locator('#m-i-qty').inputValue(),'10');
  assert.equal(await p.evaluate(()=>Object.keys(_fbPendingStoreOps).length),0);
  const before=await p.evaluate(()=>JSON.stringify(_memDB));await p.evaluate(()=>applyParsed({assets:[]}));assert.equal(await p.evaluate(()=>JSON.stringify(_memDB)),before);await p.close();
});
test('browser: sign-out clears drafts, attachment state and command identity',async()=>{
  const p=await newPage();await fillSafety(p,'Private draft');await p.evaluate(()=>{document._wPhoto='private';HAMMS_PHASE3.signOut();});
  assert.equal(await p.locator('#m-sf-desc').inputValue(),'');assert.equal(await p.evaluate(()=>document._wPhoto),null);assert.equal(await p.evaluate(()=>HAMMS_PHASE3.controller.snapshot.pending),null);assert.equal(await p.locator('#app').isVisible(),false);await p.close();
});
test('browser: existing non-stock forms use the confirmed-save path',async()=>{
  const p=await newPage();
  const scenarios=[
    {store:'assets',open:'openAssetModal',save:'saveAsset',fields:{'m-a-name':'Synthetic form asset','m-a-section':'Electrical','m-a-loc':'Test room'}},
    {store:'inventory',open:'openInvModal',save:'saveInvItem',fields:{'m-i-desc':'Synthetic zero balance','m-i-cat':'Electrical','m-i-qty':'0','m-i-unit':'piece'}},
    {store:'projects',open:'openProjectModal',save:'saveProject',fields:{'m-pj-code':'TEST-FORM','m-pj-title':'Synthetic project form'}},
    {store:'waste',open:'openWasteModal',save:'saveWaste',fields:{'m-w-type':'Sharps','m-w-vol':'0'}},
    {store:'waterLogs',open:'openWaterLogModal',save:'saveWaterLog',fields:{'m-wl-ward':'Synthetic ward'}},
    {store:'wo',open:'openWOModal',save:'saveWO',fields:{'m-wo-section':'Electrical','m-wo-asset':'__room_general__','m-wo-loc':'Test room','m-wo-desc':'Synthetic facility inspection'}},
    {store:'waterTank',open:'openTankModal',save:'saveTankReading',fields:{'m-tk-name':'Synthetic tank form','m-tk-level':'0','m-tk-cap':'100','m-tk-patients':'0'}},
    {store:'effluent',open:'openEffluentModal',save:'saveEffluent',fields:{'m-eff-point':'Synthetic outlet'}},
    {store:'medWasteProd',open:'openMedWasteModal',save:'saveMedWaste',fields:{}},
    {store:'wwProd',open:'openWWProdModal',save:'saveWWProd',fields:{}},
    {store:'energyBills',open:'openEnergyModal',save:'saveEnergy',fields:{'m-en-month':'12','m-en-year':'2026','m-en-actual':'1','m-en-amount':'1'}}
  ];
  for(const s of scenarios){
    const result=await p.evaluate(async s=>{
      const before=DB.g(s.store).length;window[s.open]();
      for(const [id,value]of Object.entries(s.fields)){const el=document.getElementById(id);if(!el)throw Error('Missing '+id);el.value=value;}
      await window[s.save]();return {before,after:DB.g(s.store).length,status:HAMMS_PHASE3.controller.snapshot.state,toast:document.getElementById('toast-container')?.textContent};
    },s);
    assert.equal(result.after,result.before+1,s.store+': '+JSON.stringify(result));
  }
  await p.close();
});
test('browser: conflict controls fit a mobile dialog without horizontal overflow',async()=>{
  const p=await newPage();await p.setViewportSize({width:390,height:844});await fillSafety(p,'Synthetic mobile draft');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await p.locator('button').filter({hasText:/^Check save status$/}).isVisible(),true);
  await fs.mkdir('test-results/phase3',{recursive:true});await p.screenshot({path:'test-results/phase3/mobile-draft.png'});await p.setViewportSize({width:1440,height:1000});await p.screenshot({path:'test-results/phase3/desktop-draft.png'});await p.close();
});
test('backend: 100 same-version paired races commit exactly one update each',async()=>{
  for(let i=0;i<100;i++) {
    const id='race-'+i;await harness.service.db.doc('hammsStores/assets/records/'+id).set({...fixtures.assets,id:100000+i,_docId:id,_v:1});
    const results=await Promise.all(['first','second'].map(remarks=>send('staff',op('updateRecord',{store:'assets',docId:id,expectedVersion:1,payload:{remarks}}))));
    assert.deepEqual(results.map(r=>r.http).sort(),[200,409]);assert.equal((await harness.service.db.doc('hammsStores/assets/records/'+id).get()).data()._v,2);
  }
});
test('backend: 100 repeated-operation races produce one identity/result each',async()=>{
  for(let i=0;i<100;i++) {
    const body=op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets});const [a,b]=await Promise.all([send('staff',body),send('staff',body)]);
    assert.equal(a.http,200);assert.deepEqual(a,b);assert.equal((await harness.service.db.doc('hammsStores/assets/records/'+a.docId).get()).data()._v,1);
  }
});
test('backend: record 100 healthy acknowledged-save timings without omitting failures',async()=>{
  const durations=[];let failed=0;
  for(let i=0;i<100;i++){
    const started=performance.now();const r=await send('staff',op('createRecord',{store:'assets',expectedVersion:0,payload:fixtures.assets}));durations.push(performance.now()-started);if(r.http!==200)failed++;
  }
  durations.sort((a,b)=>a-b);
  const metrics={profile:'loopback emulator; HTTP command acknowledgement only, excludes browser preflight/rendering and real WAN latency',samples:100,failed,p50Ms:durations[49],p95Ms:durations[94],p99Ms:durations[98]};
  await fs.mkdir('test-results/phase3',{recursive:true});await fs.writeFile('test-results/phase3/save-latency.json',JSON.stringify(metrics,null,2));console.log('PHASE3_SAVE_METRICS '+JSON.stringify(metrics));assert.equal(failed,0);
});
