import {createConfirmedSaves,SaveError} from './confirmed-saves.mjs';
import {installStockUI} from './stock-ui.mjs';

if(location.hostname!=='127.0.0.1')throw Error('Emulator UI must run on loopback');
document.getElementById('app-loading-overlay')?.remove();
const schemas=await(await fetch('/schema.json')).json();
let identity=null,stage=null,completion=null,heartbeatBusy=false,review=null;
const toast=window.showToast;
const status=document.createElement('div');status.id='phase3-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
status.style.cssText='padding:8px 12px;background:var(--navy);color:var(--white);display:flex;flex-wrap:wrap;gap:8px;align-items:center';
const label=document.createElement('span');status.append(label);
function action(text,fn){const b=document.createElement('button');b.type='button';b.className='btn btn-sm btn-ghost';b.textContent=text;b.addEventListener('click',fn);status.append(b);return b;}
document.getElementById('main').prepend(status);
function placeStatus(){
  const open=document.querySelector('.modal-overlay.open .modal-body');
  const target=open||document.getElementById('main');
  if(status.parentElement!==target)target.prepend(status);
}
const modalObserver=new MutationObserver(placeStatus);
for(const modal of document.querySelectorAll('.modal-overlay'))modalObserver.observe(modal,{attributes:true,attributeFilter:['class']});
const labels={'connecting':'Connecting','live':'Live','saving':'Saving','offline':'Offline','unavailable':'Unavailable','conflict':'Conflict','outcome-unknown':'Checking save status','signed-out':'Sign in to emulator'};
const controller=createConfirmedSaves({
  transport:request,
  journal:{
    read(uid){const value=sessionStorage.getItem('hamms-emulator-operation:'+uid);return value?JSON.parse(value):null;},
    write(uid,value){sessionStorage.setItem('hamms-emulator-operation:'+uid,JSON.stringify(value));},
    clear(uid){sessionStorage.removeItem('hamms-emulator-operation:'+uid);}
  },
  onState(s){
    const stamp=s.lastSavedAt?' · Last confirmed save '+new Date(s.lastSavedAt).toLocaleTimeString():'';
    label.textContent='LOCAL EMULATOR · '+labels[s.state]+stamp+(s.message?' · '+s.message:'');
    const chip=document.getElementById('storage-chip');if(chip){chip.textContent=labels[s.state];chip.className='tb-chip';}
  }
});
async function request(route,body){
  if(!identity)throw new SaveError('unauthenticated','Sign in to the emulator');
  // Capture the token before awaiting; account switches cannot change an in-flight request's identity.
  const token=identity.token;
  const r=await fetch('/api'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  let data;try{data=await r.json();}catch{throw new SaveError('outcome-unknown','Unreadable server response');}
  if(!r.ok)throw new SaveError(data.error?.code||'outcome-unknown',data.error?.message||'Server unavailable');return data;
}
function notify(e){toast(e.message||'Save failed; draft retained','error',8000);}
const clone=v=>JSON.parse(JSON.stringify(v));
function stateSnapshot(){return clone(_memDB);}
function restoreState(snapshot){for(const key of Object.keys(_memDB))delete _memDB[key];Object.assign(_memDB,snapshot);}
function visibleDraft(){return [...document.querySelectorAll('.modal-overlay.open input,.modal-overlay.open select,.modal-overlay.open textarea')].map(e=>[e.id,e.type==='checkbox'?e.checked:e.value]);}
async function applyCompleted(done){
  completion=done;
  const epoch=identity?.uid;
  const record=await controller.latest(done.command.store,done.result.docId);
  if(identity?.uid!==epoch)return;
  if(!record)throw new SaveError('unavailable','Save committed but record is unavailable; refresh needed');
  if(done.result.relatedStores){
    const refreshed=await request('/inspect',{load:true,stock:true});
    if(identity?.uid!==epoch)return;
    for(const store of done.result.relatedStores){_memDB[store]=refreshed.stores[store].filter(r=>!r._archived);_cleanStoreState[store]=clone(_memDB[store]);}
    window._phase4AllWO=refreshed.stores.wo;window._phase4Movements=refreshed.movements;
  }
  const list=DB.g(done.command.store).filter(r=>r._docId!==record._docId&&r.id!==record.id);
  if(!record._archived)list.push(record);
  _memDB[done.command.store]=list;_cleanStoreState[done.command.store]=clone(list);
  const draftUnchanged=review&&JSON.stringify(review.draft)===JSON.stringify(visibleDraft());
  if(!draftUnchanged&&review){
    const setters={assets:id=>{_editAsset=id;},wo:id=>{_editWO=id;},inventory:id=>{_editInv=id;},safety:id=>{_editSafety=id;},projects:id=>{_editProject=id;},waterLogs:id=>{_editWaterLog=id;},waterTank:id=>{_editTank=id;},effluent:id=>{_editEffluent=id;},medWasteProd:id=>{_editMedWaste=id;},wwProd:id=>{_editWWProd=id;},energyBills:id=>{_editEnergyBill=id;}};
    setters[done.command.store]?.(record.id);
    if(done.command.store==='issuance'&&record.source==='manual'){
      _editIssuance=record.id;
      document.getElementById('btn-iss-save').textContent='Save Changes';
      document.getElementById('btn-iss-save').onclick=window.saveIssuanceEdit;
    }
    _editSnapshots.set(done.command.store,{store:done.command.store,id:record.id,_v:record._v});
  }
  if(draftUnchanged)for(const id of review.closed)window.closeModal(id);
  completion=null;
  if(typeof navigate==='function')navigate(document.querySelector('.page.active')?.id.replace('page-','')||'dashboard');
  toast(draftUnchanged?'Saved to the emulator.':'Submitted version saved. Current form changes remain unsaved.','success');
  review=null;
}
async function reconcile(retry=false){try{if(completion)await applyCompleted(completion);else {const done=await controller.reconcile({retry});if(done)await applyCompleted(done);else toast('No confirmed result yet. The original request may still be running.','warning');}}catch(e){notify(e);}}
action('Check save status',()=>reconcile());action('Retry same operation',()=>reconcile(true));
action('Review latest record',async()=>{
  try{
    if(!review?.command.docId)throw new SaveError('failed-precondition','No conflicted existing record selected');
    const latest=await controller.latest(review.command.store,review.command.docId);
    const box=document.getElementById('phase3-latest')||document.createElement('pre');box.id='phase3-latest';box.style.cssText='white-space:pre-wrap;max-width:100%;overflow-wrap:anywhere';
    box.textContent=JSON.stringify(latest,null,2);status.after(box);
    review.latest=latest;
    toast('Latest record shown. Your form is unchanged; reopen it to start a fresh edit after review.','info');
  }catch(e){notify(e);}
});
action('Use reviewed version for retry',async()=>{
  if(!review?.latest){toast('Review the latest record first.','warning');return;}
  if(!await confirmDialog('Retry your retained form against the reviewed latest version? Your submitted fields may replace the values shown.',{title:'Review conflict',confirmText:'Use Reviewed Version'}))return;
  const latest=review.latest,store=review.command.store;
  _memDB[store]=DB.g(store).map(r=>r._docId===latest._docId?latest:r);_cleanStoreState[store]=clone(_memDB[store]);
  _editSnapshots.set(store,{store,id:latest.id,_v:latest._v});
  toast('Reviewed version selected. Your draft is unchanged; press Save to retry.','info');
});
action('Sign out',()=>signOut());

// Disable the legacy queue and network-status heuristics in this local-only view.
window.setStorageChip=()=>{};window.scheduleFlush=()=>{};window.syncToFirebase=async()=>{};window.flushAll=async()=>{};window.scheduleFBSync=()=>{};
window.queueScalarSync=()=>{throw new SaveError('failed-precondition','Scalar edits require a reviewed command adapter');};
window.queueStoreSync=()=>{throw new SaveError('failed-precondition','Legacy write queue disabled');};
DB.s=(store,value)=>{
  if(!stage)throw new SaveError('failed-precondition','Use the confirmed save adapter');
  stage.stores.add(store);_memDB[store]=clone(value);
};
const saveNames=['saveWO','saveInvItem','saveManualIssue','saveWaste','saveAsset','saveSafety','saveProject','saveWaterLog','saveIssuanceEdit','saveEffluent','saveMedWaste','saveWWProd','saveEnergy','saveCensus','saveWaterSettings','saveTankReading'];
// Some water functions are named differently across recovered releases; support only actual globals.
for(const name of saveNames)if(typeof window[name]==='function'){
  const original=window[name];
  window[name]=async function(...args){
    if(controller.snapshot.busy||controller.snapshot.pending||completion){notify(new SaveError('busy','Resolve the current save before submitting another'));return;}
    if(!identity||!navigator.onLine){controller.disconnected();notify(new SaveError('offline','Sign in online and retry. Form input is retained.'));return;}
    const before=stateSnapshot(),closed=[],renderers={};
    const oldClose=window.closeModal,oldToast=window.showToast;
    const transient={wo:document._woReport,waste:document._wPhoto,water:document._wlResultImg};
    stage={stores:new Set()};
    window.closeModal=id=>closed.push(id);window.showToast=(msg,type)=>{if(type&&type!=='success')oldToast(msg,type);};
    for(const k of Object.keys(window))if(/^render[A-Z]|^updateInvAlerts$/.test(k)&&typeof window[k]==='function'){renderers[k]=window[k];window[k]=()=>{};}
    let changes;
    try {
      const returned=original(...args);if(returned?.then)throw new SaveError('failed-precondition','Async legacy save requires an explicit adapter');
      changes=[...stage.stores].flatMap(store=>{
        const previous=before[store]||[],next=_memDB[store]||[];
        if(previous.some(p=>!next.some(n=>n.id===p.id)))throw new SaveError('failed-precondition','Replacement/delete requires reviewed archival');
        return next.filter(n=>{const p=previous.find(p=>p.id===n.id);return JSON.stringify(p)!==JSON.stringify(n);}).map(n=>({store,record:clone(n),old:previous.find(p=>p.id===n.id)}));
      });
    }catch(e){notify(e);return;}
    finally {
      restoreState(before);stage=null;window.closeModal=oldClose;window.showToast=oldToast;Object.assign(window,renderers);
      document._woReport=transient.wo;document._wPhoto=transient.waste;document._wlResultImg=transient.water;
    }
    if(!changes.length)return;
    if(changes.length!==1){notify(new SaveError('failed-precondition','Related stock/bulk changes require the atomic Phase 4 command. Draft retained.'));return;}
    const {store,record,old}=changes[0];
    const payload=Object.fromEntries(Object.entries(record).filter(([k])=>schemas[store].includes(k)));
    if(store==='wo'&&!old){
      const asset=_memDB.assets.filter(a=>a.name===record.asset&&a.section===record.section);
      const loc=(window._phase3Locations||[]).filter(l=>l.name===record.location);
      if(record.asset&&record.asset!=='__room_general__') {
        if(asset.length!==1){notify(new SaveError('invalid-argument','Select a unique registered asset; ambiguous names require Phase 5'));return;}
        payload.workScope='asset';payload.assetDocId=asset[0]._docId;
      }else {payload.workScope='room';if(loc.length===1)payload.locationId=loc[0].docId;}
    }
    if(old&&(!old._docId||!Number.isSafeInteger(old._v))){notify(new SaveError('failed-precondition','Legacy identity requires a reviewed migration; record unchanged'));return;}
    const snapshot=typeof _editSnapshots!=='undefined'?_editSnapshots.get(store):null;
    const command={command:old?'updateRecord':'createRecord',store,expectedVersion:old?(snapshot?.id===old.id?snapshot._v:old._v):0,payload,reason:'User submitted '+store+' form in local emulator',...(old?{docId:old._docId}:{})};
    review={command,closed,draft:visibleDraft()};
    try {await applyCompleted(await controller.submit(command));}catch(e){notify(e);}
  };
}
// Fail closed for paths not yet adapted: never fall back to a legacy mutation or import.
for(const name of Object.keys(window))if(/^(import|del[A-Z]|confirmFactoryReset|resetWaterSettings|recomputeTheoretical|savePersonnel|saveInpatient|saveEnergySettings|applyParsed)/.test(name)&&typeof window[name]==='function')window[name]=()=>toast('This action needs its reviewed command workflow; existing data is unchanged.','warning');

async function signIn(email,password){
  signOut();
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const data=await r.json();if(!r.ok)throw new SaveError('unauthenticated','Emulator login failed');
  identity={uid:data.localId,token:data.idToken};controller.account(identity.uid);
  const loaded=await request('/inspect',{load:true});
  window._phase3Locations=loaded.locations;
  window._phase4AllWO=loaded.stores.wo;
  for(const [store,rows]of Object.entries(loaded.stores)){_memDB[store]=rows.filter(r=>!r._archived);_cleanStoreState[store]=clone(_memDB[store]);}
  window._FB={enabled:false,email,uid:identity.uid,signOut};
  document.getElementById('hamms-login-overlay').style.cssText='display:none!important';document.getElementById('app').style.visibility='visible';
  await controller.probe();navigate('dashboard');return true;
}
function signOut(){
  identity=null;completion=null;review=null;controller.account(null);
  for(const store of Object.keys(_memDB))_memDB[store]=Array.isArray(_memDB[store])?[]:{};
  for(const k of Object.keys(_cleanStoreState))delete _cleanStoreState[k];
  if(typeof _editSnapshots!=='undefined')_editSnapshots.clear();
  if(typeof _woMaterials!=='undefined')_woMaterials=[];
  if(typeof _assetImageData!=='undefined')_assetImageData=null;
  if(typeof _dashCache!=='undefined')_dashCache=null;
  for(const key of ['_alerts','_effCustomParams','_phase3Locations','_phase4AllWO','_phase4Movements'])window[key]=[];
  window.dispatchEvent(new Event('hamms-session-ended'));
  document.querySelectorAll('.modal-overlay input,.modal-overlay textarea,.modal-overlay select').forEach(e=>{if(e.type==='checkbox')e.checked=false;else e.value='';});
  document.querySelectorAll('.modal-overlay').forEach(e=>e.classList.remove('open'));
  document._woReport=null;document._wPhoto=null;document._wlResultImg=null;window._phase3Locations=[];
  document.getElementById('phase3-latest')?.remove();
  document.getElementById('hamms-login-overlay').style.cssText='display:flex';document.getElementById('app').style.visibility='hidden';
  window._FB={enabled:false};
}
window.hammsLogin=async()=>{try{await signIn(document.getElementById('login-email').value,document.getElementById('login-password').value);document.getElementById('login-password').value='';}catch(e){signOut();notify(e);}};
document.getElementById('login-email').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('login-password').focus();}});
window.addEventListener('offline',()=>controller.disconnected());
window.addEventListener('online',()=>controller.probe()); // A status read only; never replay a save.
const heartbeat=setInterval(async()=>{if(!identity||heartbeatBusy||controller.snapshot.busy)return;heartbeatBusy=true;try{await controller.probe();}finally{heartbeatBusy=false;}},10000);
window.addEventListener('pagehide',()=>{clearInterval(heartbeat);modalObserver.disconnect();});
window.HAMMS_PHASE3={signIn,signOut,controller,reconcile,ready:true};
installStockUI({
  async submit(command,closed=[]){
    if(completion||controller.snapshot.busy||controller.snapshot.pending)throw new SaveError('busy','Resolve the current save first');
    review={command,closed,draft:visibleDraft()};
    await applyCompleted(await controller.submit(command));
  },request,notify,toast,watchModal:modal=>modalObserver.observe(modal,{attributes:true,attributeFilter:['class']})
});
// Always require explicit local sign-in, regardless of the legacy Firebase-disabled fallback.
document.getElementById('hamms-login-overlay').style.cssText='display:flex!important';document.getElementById('app').style.visibility='hidden';
