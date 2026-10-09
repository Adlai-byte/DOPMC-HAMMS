import {test,expect} from '@playwright/test';
import {bootstrapApp} from './helpers/bootstrap.mjs';

test.beforeEach(async({page})=>{
 await bootstrapApp(page);
 await page.evaluate(()=>{
  window.serverRows=new Map();window.commits=[];window.failCommit=0;window.beforeCommit=null;
  window._FB={enabled:true,db:{},auth:{currentUser:{uid:'staff',email:'test@example.com'}},email:'test@example.com',
   doc:(_db,...parts)=>parts.join('/'),serverTimestamp:()=>123,
   setDoc:async(ref,data)=>{serverRows.set(ref,data);},
   runTransaction:async(_db,callback)=>{
    const changes=[];
    const result=await callback({get:async ref=>({exists:()=>serverRows.has(ref),data:()=>structuredClone(serverRows.get(ref))}),set:(ref,data)=>changes.push([ref,data]),delete:ref=>changes.push([ref,null])});
    if(beforeCommit)await beforeCommit();
    if(failCommit===commits.length+1)throw new Error('Simulated rejected transaction');
    for(const [ref,data] of changes){if(data)serverRows.set(ref,data);else serverRows.delete(ref);}
    commits.push(changes);return result;
   }};
  _fbLoadedOnce=true;_fbAllFromCache=false;
 });
});

test('partial success acknowledges only committed chunks and retries the remainder',async({page})=>{
 const result=await page.evaluate(async()=>{
  DB.s('assets',Array.from({length:451},(_,i)=>({id:i+1,_docId:'a'+i,name:'Asset'})));
  failCommit=2;try{await flushAll();}catch{}
  const remaining=Object.keys(_fbPendingStoreOps.assets.upserts).length;
  failCommit=0;await flushAll();
  return {remaining,size:serverRows.size,pending:pendingWrites(),commits:commits.length};
 });
 expect(result).toEqual({remaining:1,size:452,pending:false,commits:2});
});

test('an edit queued while a transaction is in flight is not erased by acknowledgement',async({page})=>{
 const result=await page.evaluate(async()=>{
  let release;const held=new Promise(r=>release=r);let started;const ready=new Promise(r=>started=r);
  beforeCommit=async()=>{beforeCommit=null;started();await held;};
  DB.s('assets',[{id:1,_docId:'asset',name:'First'}]);const saving=flushAll();await ready;
  DB.s('assets',[{id:1,_docId:'asset',name:'Second'}]);release();await saving;
  return {row:serverRows.get('hammsStores/assets/records/asset'),pending:pendingWrites(),commits:commits.length};
 });
 expect(result.row.name).toBe('Second');expect(result.row._v).toBe(2);expect(result.pending).toBe(false);expect(result.commits).toBe(2);
});

test('a stale remote version rejects the entire related stock operation',async({page})=>{
 const result=await page.evaluate(async()=>{
  const row={id:1,_docId:'lamp',qty:10,_v:1};applyStoreData('inventory',[row]);
  serverRows.set('hammsStores/inventory/records/lamp',{...row,qty:8,_v:2});
  commitLocalChanges({inventory:[{...row,qty:5}],issuance:[{id:2,_docId:'issue',qtyIssued:5}]});
  let error;try{await flushAll();}catch(e){error=e.message;}
  return {error,qty:serverRows.get('hammsStores/inventory/records/lamp').qty,issue:serverRows.has('hammsStores/issuance/records/issue'),pending:pendingWrites()};
 });
 expect(result.error).toContain('Conflict');expect(result.qty).toBe(8);expect(result.issue).toBe(false);expect(result.pending).toBe(true);
});

test('failed save retains form and does not display success',async({page})=>{
 const result=await page.evaluate(async()=>{
  openInvModal();document.getElementById('m-i-desc').value='Draft lamp';document.getElementById('m-i-qty').value='3';document.getElementById('m-i-cat').value='Electrical';
  window._alerts=[];failCommit=1;await saveInvItem();
  return {open:document.getElementById('mo-inv').classList.contains('open'),value:document.getElementById('m-i-desc').value,alerts:_alerts,pending:pendingWrites()};
 });
 expect(result.open).toBe(true);expect(result.value).toBe('Draft lamp');expect(result.pending).toBe(true);expect(result.alerts.join(' ')).not.toContain('Inventory item saved');
});

test('offline save preserves input without changing records',async({page,context})=>{
 await context.setOffline(true);
 const result=await page.evaluate(async()=>{
  openInvModal();document.getElementById('m-i-desc').value='Offline draft';await saveInvItem();
  return {value:document.getElementById('m-i-desc').value,count:DB.g('inventory').length,pending:pendingWrites()};
 });
 expect(result).toEqual({value:'Offline draft',count:0,pending:false});
});

test('restore checks administrator before changing stores and stamps committed records',async({page})=>{
 const result=await page.evaluate(async()=>{
  const backup={system:'HAMMS',...Object.fromEntries(STORES.map(s=>[s,[]]))};backup.assets=[{id:1,_docId:'asset',name:'Restored',_v:70,_updatedBy:'old@example.com'}];
  let blocked=false;try{applyParsed(backup);}catch{blocked=true;}
  const before=DB.g('assets').length;_FB.isAdmin=true;applyParsed(backup);await flushAll();
  return {blocked,before,row:serverRows.get('hammsStores/assets/records/asset'),atomic:commits[0].some(([ref])=>ref==='hammsMeta/state')};
 });
 expect(result.blocked).toBe(true);expect(result.before).toBe(0);expect(result.row._v).toBe(1);expect(result.row._updatedBy).toBe('test@example.com');expect(result.atomic).toBe(true);
});

test('logout clears queues, actor, listeners, and session data',async({page})=>{
 const result=await page.evaluate(()=>{
  DB.s('assets',[{id:1,name:'Private'}]);let unsubscribed=false;_fbUnsubscribe=[()=>unsubscribed=true];
  resetAuthSession();return {pending:pendingWrites(),email:_FB.email,count:DB.g('assets').length,unsubscribed};
 });
 expect(result).toEqual({pending:false,email:'',count:0,unsubscribed:true});
});

test('retry completes the saved form only after the server acknowledges it',async({page})=>{
 const result=await page.evaluate(async()=>{
  openInvModal();document.getElementById('m-i-desc').value='Retry lamp';document.getElementById('m-i-cat').value='Electrical';document.getElementById('m-i-qty').value='3';
  failCommit=1;await saveInvItem();const retained=document.getElementById('mo-inv').classList.contains('open');
  failCommit=0;await retryPendingChanges();
  return {retained,open:document.getElementById('mo-inv').classList.contains('open'),pending:pendingWrites(),rows:DB.g('inventory').length};
 });
 expect(result).toEqual({retained:true,open:false,pending:false,rows:1});
});

test('new metadata queued during acknowledgement is not lost',async({page})=>{
 const result=await page.evaluate(async()=>{
  let first=true;_FB.setDoc=async(ref,data)=>{serverRows.set(ref,data);if(first){first=false;queueScalarSync('inpatientToday',2);}};
  queueScalarSync('inpatientToday',1);await flushAll();
  return {count:serverRows.get('hammsMeta/state').inpatientToday,pending:pendingWrites()};
 });
 expect(result).toEqual({count:2,pending:false});
});

test('a malformed later backup store cannot partially replace an earlier store',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('assets',[{id:1,name:'Original'}]);_FB.isAdmin=true;
  const backup={system:'HAMMS',...Object.fromEntries(STORES.map(s=>[s,[]]))};backup.projects=[{id:2,physicalPct:'<img src=x>'}];
  let rejected=false;try{applyParsed(backup);}catch{rejected=true;}
  return {rejected,name:DB.g('assets')[0]?.name,pending:pendingWrites()};
 });
 expect(result).toEqual({rejected:true,name:'Original',pending:false});
});

test('server read failure does not silently use stale cached records',async({page})=>{
 const result=await page.evaluate(async()=>{
  let cacheRead=false;_FB.getDocFromServer=async()=>{throw new Error('permission-denied');};_FB.getDoc=async()=>{cacheRead=true;return {};};
  let rejected=false;try{await safeGetDocFresh('record');}catch{rejected=true;}
  return {rejected,cacheRead};
 });
 expect(result).toEqual({rejected:true,cacheRead:false});
});

test('an old legacy read cannot refill memory after sign-out',async({page})=>{
 const result=await page.evaluate(async()=>{
  let release;_FB.getDocFromServer=()=>new Promise(r=>release=r);
  _fbLegacyParsed=null;const loading=loadLegacyMainData();resetAuthSession();
  release({exists:()=>true,data:()=>({data:JSON.stringify({assets:[{id:1,name:'Old account'}]})})});
  let rejected=false;try{await loading;}catch{rejected=true;}
  return {rejected,legacy:_fbLegacyParsed,count:DB.g('assets').length};
 });
 expect(result).toEqual({rejected:true,legacy:null,count:0});
});
