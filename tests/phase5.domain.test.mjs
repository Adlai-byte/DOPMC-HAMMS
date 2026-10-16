import test from 'node:test';
import assert from 'node:assert/strict';
import {sameLocation,classifyWorkOrder,assetHistory,roomHistory,reviewRelationships,previewRelationshipImport} from '../security/relationship-domain.mjs';
const locations=[{docId:'rsa',name:'DIETARY RSA',aliases:['RSA Dietary']},{docId:'kitchen',name:'DIETARY KITCHEN'},{docId:'diet',name:'DIETARY'},{docId:'icu',name:'ICU',aliases:['Intensive Care Unit']},{docId:'nicu',name:'NICU'},{docId:'picu',name:'PICU'},{docId:'r316',name:'RM 316',aliases:['Room 316']},{docId:'r317',name:'RM 317'}];
const assets=[{_docId:'light-a',id:1,name:'Lighting',section:'Electrical',assetCode:'RSA-01',locationId:'rsa',location:'DIETARY RSA'},{_docId:'light-b',id:2,name:'Lighting',section:'Electrical',assetCode:'RSA-02',locationId:'rsa',location:'DIETARY RSA'},{_docId:'kitchen-light',id:3,name:'Lighting',section:'Electrical',locationId:'kitchen',location:'DIETARY KITCHEN'}];
for(const [a,b]of [['DIETARY RSA','DIETARY'],['DIETARY RSA','DIETARY KITCHEN'],['ICU','NICU'],['NICU','PICU'],['RM 316','RM 317'],['Room 316','Ward 316'],['Dietary RSA','RSA']])test(`no location leakage: ${a} / ${b}`,()=>assert.equal(sameLocation(a,b,locations),false));
test('only exact locations or explicit reviewed aliases match',()=>{assert.equal(sameLocation('RSA Dietary','DIETARY RSA',locations),true);assert.equal(sameLocation('ICU','Intensive Care Unit',locations),true);assert.equal(sameLocation(' room 316 ','RM 316',locations),true);assert.equal(sameLocation('Dietary','Dietary Kitchen',[]),false);});
test('stable asset ID prevents identical-name contamination and survives rename',()=>{
  const wos=[{_docId:'a',workScope:'asset',assetDocId:'light-a',locationId:'rsa'},{_docId:'b',workScope:'asset',assetDocId:'light-b',locationId:'rsa'},{_docId:'room',workScope:'room',locationId:'rsa',description:'Lighting repair'}];
  assert.deepEqual(assetHistory('light-a',wos,assets,locations).records.map(w=>w._docId),['a']);
  assert.equal(assetHistory('light-a',wos,assets.map(a=>({...a,name:'Renamed'})),locations).records.length,1);
  assert.equal(roomHistory('kitchen',wos,assets,locations).records.length,0);
});
test('legacy names and description fragments never become confirmed repair history',()=>{
  const w={_docId:'legacy',asset:'Lighting',location:'DIETARY RSA',section:'Electrical',description:'RSA-01'};
  assert.equal(classifyWorkOrder(w,assets,locations).classification,'unresolved');assert.equal(assetHistory('light-a',[w],assets,locations).records.length,0);
  const unique={...w,asset:'RSA-01'};assert.equal(classifyWorkOrder(unique,assets,locations).classification,'legacy-unique-candidate');assert.equal(assetHistory('light-a',[unique],assets,locations).records.length,0);
});
test('dangling IDs and malformed room scopes stay unresolved',()=>{for(const w of [{workScope:'asset',assetDocId:'missing'},{workScope:'room',locationId:'rsa',assetDocId:'light-a'},{workScope:'room',locationId:'missing'}])assert.equal(classifyWorkOrder(w,assets,locations).classification,'unresolved');});
test('archived repairs remain available explicitly and archived assets retain history',()=>{const w={_docId:'archived',workScope:'asset',assetDocId:'light-a',locationId:'rsa',_archived:true};assert.equal(assetHistory('light-a',[w],assets,locations).records.length,0);assert.equal(assetHistory('light-a',[w],assets.map(a=>({...a,_archived:true})),locations,{includeArchived:true}).records.length,1);});
test('every legacy WO is classified without any proposed writes or mutations',()=>{const data={assets,locations,wo:[{_docId:'legacy',asset:'Lighting',location:'DIETARY RSA',section:'Electrical'},{_docId:'room',asset:'__room_general__',location:'DIETARY KITCHEN'}]};const before=JSON.stringify(data),report=reviewRelationships(data);assert.equal(report.records.length,2);assert.equal(report.counts.classified,2);assert.deepEqual(report.proposedWrites,[]);assert.equal(JSON.stringify(data),before);});
test('import preview rejects duplicate codes, unknown locations, missing scope and ambiguous identities',()=>{
  assert.equal(previewRelationshipImport('assets',[{name:'New',assetCode:'RSA-01',locationId:'rsa'}],{assets,locations}).valid,false);
  assert.equal(previewRelationshipImport('assets',[{name:'New',assetCode:'NEW',locationId:'missing'}],{assets,locations}).valid,false);
  assert.equal(previewRelationshipImport('wo',[{asset:'Lighting',location:'DIETARY RSA'}],{assets,locations}).valid,false);
  assert.equal(previewRelationshipImport('wo',[{workScope:'asset',assetDocId:'light-a',locationId:'rsa',section:'Electrical'}],{assets,locations}).valid,true);
});
test('work-order import duplicate codes are compared against existing and candidate rows',()=>{
  const r={code:'EXISTING',workScope:'room',locationId:'rsa'};assert.equal(previewRelationshipImport('wo',[r],{assets,locations,wo:[r]}).valid,false);assert.equal(previewRelationshipImport('wo',[{...r,code:'New'},{...r,code:'new'}],{assets,locations}).valid,false);
});
