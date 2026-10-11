import {before,after,beforeEach,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,deleteDoc,getDoc} from 'firebase/firestore';
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-hamms-tests',firestore:{rules:readFileSync('firestore.rules','utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>env.clearFirestore());
const staff=()=>env.authenticatedContext('staff',{email:'staff@example.com'}).firestore();
const admin=()=>env.authenticatedContext('admin',{email:'admin@example.com',admin:true}).firestore();
const path='hammsStores/inventory/records/lamp';
const row=(extra={})=>({_docId:'lamp',id:1,_v:1,_updatedAt:123,_updatedBy:'staff@example.com',qty:3,...extra});
test('named staff create, edit, and delete another staff record',async()=>{
 await assertSucceeds(setDoc(doc(staff(),path),row()));
 const other=env.authenticatedContext('other',{email:'other@example.com'}).firestore();
 await assertSucceeds(setDoc(doc(other,path),row({_v:2,_updatedBy:'other@example.com'})));
 await assertSucceeds(deleteDoc(doc(staff(),path)));
});
test('anonymous reads, unknown stores, spoofed identities and missing versions fail',async()=>{
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),path)));
 await assertFails(setDoc(doc(staff(),'hammsStores/unknown/records/lamp'),row()));
 await assertFails(setDoc(doc(staff(),path),row({_updatedBy:'other@example.com'})));
 await assertFails(setDoc(doc(staff(),path),{id:1,_updatedBy:'staff@example.com'}));
 await assertFails(setDoc(doc(staff(),path),row({_docId:'wrong'})));
});
test('updates must advance exactly one server version',async()=>{
 await setDoc(doc(staff(),path),row());
 await assertFails(setDoc(doc(staff(),path),row()));
 await assertFails(setDoc(doc(staff(),path),row({_v:3})));
 await assertSucceeds(setDoc(doc(staff(),path),row({_v:2})));
});
test('legacy records migrate with version one',async()=>{
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),path),{id:1,qty:2}));
 await assertSucceeds(setDoc(doc(staff(),path),row()));
});
test('restore and reset markers require an administrator',async()=>{
 const meta='hammsMeta/state';
 await assertFails(setDoc(doc(staff(),meta),{updatedBy:'staff@example.com',restoreAt:'now'}));
 await assertSucceeds(setDoc(doc(admin(),meta),{updatedBy:'admin@example.com',restoreAt:'now',resetAt:'now'}));
 await assertFails(setDoc(doc(staff(),meta),{updatedBy:'staff@example.com',restoreAt:'later'},{merge:true}));
 await assertSucceeds(setDoc(doc(staff(),meta),{updatedBy:'staff@example.com',inpatientToday:12},{merge:true}));
 await assertFails(deleteDoc(doc(staff(),meta)));
});
test('carbon settings and legacy migration markers are administrator-only',async()=>{
 const meta=doc(staff(),'hammsMeta/state');
 await assertFails(setDoc(meta,{updatedBy:'staff@example.com',energySettings:{revision:1}}));
 await assertFails(setDoc(meta,{updatedBy:'staff@example.com',legacyMigrations:{waste:{count:1}}}));
 await assertSucceeds(setDoc(doc(admin(),'hammsMeta/state'),{updatedBy:'admin@example.com',energySettings:{revision:1},legacyMigrations:{waste:{count:1}}}));
 await assertFails(setDoc(meta,{updatedBy:'staff@example.com',energySettings:{revision:2}},{merge:true}));
 await assertFails(setDoc(meta,{updatedBy:'staff@example.com',legacyMigrations:{}},{merge:true}));
 await assertSucceeds(setDoc(meta,{updatedBy:'staff@example.com',inpatientToday:10},{merge:true}));
});
test('staff bill snapshots must use registered factors or preserve the existing snapshot',async()=>{
 const factor={id:'verified',value:.5,unit:'kgCO2e/kWh',status:'verified',grid:'Synthetic grid',source:'Synthetic fixture'};
 await setDoc(doc(admin(),'hammsMeta/state'),{updatedBy:'admin@example.com',energySettings:{factorById:{verified:factor}}});
 const billPath='hammsStores/energyBills/records/bill',bill={...row(),_docId:'bill',period:'2026-01',actualKwh:100,carbonFactor:factor};
 await assertSucceeds(setDoc(doc(staff(),billPath),bill));
 await assertFails(setDoc(doc(staff(),billPath),{...bill,_v:2,carbonFactor:{...factor,value:.9}}));
 await setDoc(doc(admin(),'hammsMeta/state'),{updatedBy:'admin@example.com',energySettings:{factorById:{}}});
 await assertSucceeds(setDoc(doc(staff(),billPath),{...bill,_v:2,actualKwh:120}));
 await assertFails(setDoc(doc(staff(),'hammsStores/energyBills/records/other'),{...bill,_docId:'other'}));
});
