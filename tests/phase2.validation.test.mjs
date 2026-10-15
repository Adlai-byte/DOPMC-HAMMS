import test from 'node:test';
import assert from 'node:assert/strict';
import {STORES} from '../scripts/recovery-core.mjs';
import {validateRecord,validateMembership,validateEnergySettings,date,SCHEMAS} from '../security/validation.mjs';
import {requireEmulators,SECURITY_PROJECT} from '../security/service.mjs';
import {fixtures} from './phase2-fixtures.mjs';

for(const store of STORES) {
  test(`${store}: valid synthetic payload is retained exactly`,()=>assert.deepEqual(validateRecord(store,fixtures[store]),fixtures[store]));
  for(const field of ['_updatedBy','_v','_docId','id','_archived','unexpected']) {
    test(`${store}: rejects injected ${field}`,()=>assert.throws(()=>validateRecord(store,{...fixtures[store],[field]:'forged'}),e=>e.code==='invalid-argument'));
  }
  test(`${store}: rejects null and array payloads`,()=>{for(const v of [null,[],true,'x'])assert.throws(()=>validateRecord(store,v),e=>e.code==='invalid-argument');});
}
test('schemas cover all 15 stores exactly',()=>assert.deepEqual(Object.keys(SCHEMAS).sort(),[...STORES].sort()));
test('invalid and impossible dates rejected without uncaught range errors',()=>{for(const v of ['2026-02-30','2026-13-01','2026-01-99','2025-02-29','2026/01/01'])assert.equal(date(v),false);assert.equal(date('2024-02-29'),true);});
test('date inversions are rejected',()=>assert.throws(()=>validateRecord('wo',{...fixtures.wo,dateStart:'2026-10-15',dateEnd:'2026-10-14'}),e=>e.code==='invalid-argument'));
test('negative, infinite and string stock rejected',()=>{for(const qty of [-1,NaN,Infinity,'1'])assert.throws(()=>validateRecord('inventory',{...fixtures.inventory,qty}),e=>e.code==='invalid-argument');});
test('invalid enum, integer, percentage and nested row rejected',()=>{for(const [store,patch]of [['wo',{status:'Fake'}],['censusLog',{count:1.5}],['projects',{physicalPct:101}],['wo',{materials:[{qty:1,invId:1,unexpected:true}]}]])assert.throws(()=>validateRecord(store,{...fixtures[store],...patch}),e=>e.code==='invalid-argument');});
test('room and equipment scopes enforce relationship fields',()=>{assert.throws(()=>validateRecord('wo',{...fixtures.wo,assetDocId:'asset'}));assert.throws(()=>validateRecord('wo',{...fixtures.wo,workScope:'asset'}));});
test('timestamp aliases and out of range hours fail',()=>{assert.throws(()=>validateRecord('waterTank',{...fixtures.waterTank,dateTime:'2026-10-15T24:00'}));assert.throws(()=>validateRecord('waterTank',{...fixtures.waterTank,datetime:'2026-10-14T08:00'}));});
test('existing condition/compliance classifications retained without normalization',()=>{
  assert.equal(validateRecord('assets',{...fixtures.assets,condition:'For Replacement'}).condition,'For Replacement');
  for(const emb of ['Warning','Critical'])assert.equal(validateRecord('waste',{...fixtures.waste,emb}).emb,emb);
});
test('effluent custom parameters are bounded and reject undeclared nested fields',()=>{
  const payload={...fixtures.effluent,customParams:[{name:'Synthetic parameter',value:0,unit:'mg/L'}]};assert.deepEqual(validateRecord('effluent',payload),payload);
  assert.throws(()=>validateRecord('effluent',{...payload,customParams:[{...payload.customParams[0],unknown:true}]}));
});
test('optional tank counts and existing activity labels remain unchanged',()=>{
  const payload={...fixtures.waterTank,outpatients:null,operationalFactors:['Outdoor Watering']};assert.deepEqual(validateRecord('waterTank',payload),payload);
});
test('membership only accepts active role and fixed facility schema',()=>{validateMembership({role:'staff',active:true,facilityId:'dopmc'});for(const v of [{role:'owner',active:true,facilityId:'dopmc'},{role:'admin',active:'true',facilityId:'dopmc'},{role:'admin',active:true,facilityId:'other'}])assert.throws(()=>validateMembership(v));});
test('factor settings require provenance and bounded values',()=>{const s={gridRegion:'Test',emissionFactor:0,targetReductionPct:0,baselineYear:2026,factorSource:'Synthetic test only'};validateEnergySettings(s);assert.throws(()=>validateEnergySettings({...s,factorSource:''}));assert.throws(()=>validateEnergySettings({...s,emissionFactor:-1}));});
test('trusted service refuses missing, wrong-project, remote and forwarded emulators',()=>{
  const valid={FIRESTORE_EMULATOR_HOST:'127.0.0.1:8186',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098'};
  requireEmulators(SECURITY_PROJECT,valid);
  assert.throws(()=>requireEmulators('demoapp-7864a',valid));assert.throws(()=>requireEmulators(SECURITY_PROJECT,{}));
  for(const k of Object.keys(valid))for(const value of ['localhost:8186','firestore.googleapis.com:443','127.0.0.1:8186@evil'])assert.throws(()=>requireEmulators(SECURITY_PROJECT,{...valid,[k]:value}));
});
