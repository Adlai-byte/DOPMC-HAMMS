import test from 'node:test';
import assert from 'node:assert/strict';
import {units,quantity,materialLines,stockPlan,stockBody} from '../security/stock-domain.mjs';
const line=(lineId,qty,invDocId='item')=>({lineId,invDocId,qty,issuedTo:'Synthetic recipient'});
test('four-decimal integer accounting has exact round trips',()=>{for(const value of [0,0.0001,0.1,1.2345,1000000000])assert.equal(quantity(units(value,{zero:true})),value);});
test('invalid quantities rejected',()=>{for(const v of [NaN,Infinity,-1,0,0.00001,'1',null,1e10])assert.throws(()=>units(v));assert.equal(units(-0.0001,{signed:true}),-1);});

test('stock commands reject missing payloads and invalid manual metadata',()=>{
  for(const payload of [undefined,null,[]])assert.throws(()=>stockBody({command:'issueStock',expectedVersion:0,payload}),{code:'invalid-argument'});
  const base={command:'issueStock',store:'issuance',expectedVersion:0,payload:{invDocId:'item',qty:1}};
  for(const patch of [{section:'Unknown'},{woRef:123}])assert.throws(()=>stockBody({...base,payload:{...base.payload,...patch}}),{code:'invalid-argument'});
});
test('duplicate inventory selections aggregate before availability check',()=>{const rows=materialLines([line('one',3),line('two',4)]);assert.deepEqual(stockPlan([],rows),[{invDocId:'item',deltaUnits:-70000}]);});
test('duplicate line IDs and nested protected fields rejected',()=>{assert.throws(()=>materialLines([line('same',1),line('same',1)]));assert.throws(()=>materialLines([{...line('one',1),_v:1}]));});
test('unchanged edit has zero stock delta; increases deduct only difference',()=>{const old=materialLines([line('one',3)]);assert.equal(stockPlan(old,old)[0].deltaUnits,0);assert.equal(stockPlan(old,materialLines([line('one',5)]))[0].deltaUnits,-20000);assert.equal(stockPlan(old,materialLines([line('one',2)]))[0].deltaUnits,10000);});
test('manual return and cancellation require physical confirmation',()=>{
  assert.throws(()=>stockBody({command:'returnStock',store:'issuance',docId:'issue',expectedVersion:1,payload:{qty:1,inventoryVersion:1}}));
  assert.throws(()=>stockBody({command:'cancelWorkOrder',store:'wo',docId:'wo',expectedVersion:1,payload:{returns:[{lineId:'one',qty:1}],inventoryVersions:{}}}));
});
test('receipt cannot use signed negative quantity and adjustment requires explicit amount',()=>{
  assert.throws(()=>stockBody({command:'receiveStock',store:'inventory',docId:'item',expectedVersion:1,payload:{quantity:-1}}));
  stockBody({command:'adjustStock',store:'inventory',docId:'item',expectedVersion:1,payload:{quantity:-1}});
});
for(let i=0;i<30;i++)test(`stock delta reconciliation fixture ${i+1}`,()=>{
  const a=(i+1)*0.125,b=(i%7+1)*0.25,c=(i%3+1)*0.5;
  const before=materialLines([line('a',a),line('b',b)]),after=materialLines([line('a',c),line('c',b)]);
  assert.equal(stockPlan(before,after)[0].deltaUnits,units(a)+units(b)-units(c)-units(b));
});
