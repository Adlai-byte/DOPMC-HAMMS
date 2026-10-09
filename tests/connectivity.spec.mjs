import {test,expect} from '@playwright/test';
import {bootstrapApp} from './helpers/bootstrap.mjs';
test.beforeEach(async({page})=>{
 await bootstrapApp(page);
 await page.evaluate(()=>{
  window.listenerCalls=[];
  _FB={enabled:true,db:{},email:'test@example.com',auth:{currentUser:{uid:'staff'}},
   doc:(_db,...parts)=>parts.join('/'),collection:(_db,...parts)=>parts.join('/'),
   onSnapshot:(ref,...args)=>{const options=typeof args[0]==='object'?args.shift():{};listenerCalls.push({ref,options,next:args[0],error:args[1]});return ()=>{};}};
  _fbLoadedOnce=true;_fbAllFromCache=false;_fbReadError=null;_fbSyncError=null;
  setStorageChip('firebase-live');startFirebaseListener();
  window.emitSnapshot=(ref,fromCache)=>{
   const listener=listenerCalls.find(c=>c.ref===ref);
   listener.next({metadata:{fromCache,hasPendingWrites:false},docs:[],exists:()=>false,data:()=>({})});
  };
 });
});
test('initial cached snapshots after a successful server load do not label the app offline or block saves',async({page})=>{
 const result=await page.evaluate(()=>{
  emitSnapshot('hammsStores/inventory/records',false);
  emitSnapshot('hammsStores/projects/records',true);
  return {online:navigator.onLine,chip:document.getElementById('storage-chip').textContent,canSave:canSave()};
 });
 expect(result).toEqual({online:true,chip:'Live',canSave:true});
});
test('every listener requests metadata changes so unchanged server data can confirm connectivity',async({page})=>{
 expect(await page.evaluate(()=>listenerCalls.length===STORES.length+1&&listenerCalls.every(c=>c.options.includeMetadataChanges===true))).toBe(true);
});
test('confirmed listener cache-only transitions mark disconnected and server confirmation restores Live',async({page})=>{
 const result=await page.evaluate(()=>{
  listenerCalls.forEach(c=>emitSnapshot(c.ref,false));
  listenerCalls.forEach(c=>emitSnapshot(c.ref,true));
  const disconnected=document.getElementById('storage-chip').textContent;
  emitSnapshot('hammsMeta/state',false);
  return {disconnected,recovered:document.getElementById('storage-chip').textContent,canSave:canSave()};
 });
 expect(result).toEqual({disconnected:'Connecting…',recovered:'Live',canSave:true});
});
