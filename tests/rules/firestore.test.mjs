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
