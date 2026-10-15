import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmedSaves,SaveError} from '../security/client/confirmed-saves.mjs';
const command={command:'updateRecord',store:'assets',docId:'asset',expectedVersion:1,payload:{remarks:'draft'},reason:'Synthetic test'};
const committed={status:'committed',docId:'asset',version:2};
function setup({handler,online=true,timeoutMs=100}={}){
  let network=online;const calls=[],states=[];
  const controller=createConfirmedSaves({timeoutMs,isOnline:()=>network,onState:s=>states.push(s),transport:async(route,body)=>{
    calls.push({route,body});if(handler)return handler(route,body,calls);return route==='/inspect'?{uid:'staff',verifiedAt:1,maintenance:false}:committed;
  }});controller.account('staff');return {controller,calls,states,setOnline:v=>network=v};
}
test('success waits for acknowledgement and uses one frozen operation identity',async()=>{
  let release;const x=setup({handler:async(route)=>route==='/inspect'?{uid:'staff',verifiedAt:1}:await new Promise(r=>release=r)});
  const waiting=x.controller.submit(command);await new Promise(r=>setImmediate(r));assert.equal(x.controller.snapshot.state,'saving');assert.equal(x.controller.snapshot.lastSavedAt,null);
  release(committed);const done=await waiting;assert.equal(done.result.version,2);assert.equal(x.controller.snapshot.state,'live');assert.equal(x.calls.filter(c=>c.route==='/commands').length,1);
});
test('double clicks cannot submit overlapping commands',async()=>{
  let release;const x=setup({handler:async(route)=>route==='/inspect'?{uid:'staff',verifiedAt:1}:await new Promise(r=>release=r)});
  const waiting=x.controller.submit(command);await new Promise(r=>setImmediate(r));await assert.rejects(x.controller.submit(command),e=>e.code==='busy');release(committed);await waiting;
});
test('offline submission has no transport calls and reconnect probe never replays',async()=>{
  const x=setup({online:false});await assert.rejects(x.controller.submit(command),e=>e.code==='offline');assert.equal(x.calls.length,0);assert.equal(x.controller.snapshot.pending,null);
  x.setOnline(true);await x.controller.probe();assert.equal(x.calls.filter(c=>c.route==='/commands').length,0);
});
test('a stale conflict is definitive, retains caller draft, and requires a new reviewed submit',async()=>{
  const draft=structuredClone(command);const x=setup({handler:async(route)=>{if(route==='/inspect')return{uid:'staff',verifiedAt:1};throw new SaveError('aborted','Review latest');}});
  await assert.rejects(x.controller.submit(draft),e=>e.code==='aborted');assert.equal(x.controller.snapshot.state,'conflict');assert.deepEqual(draft,command);assert.equal(x.controller.snapshot.pending,null);
});
test('lost response locks new submission; absent outcome remains unknown',async()=>{
  const x=setup({handler:async(route)=>{if(route==='/inspect')return {uid:'staff',verifiedAt:1,outcome:null};throw Error('Network lost');}});
  await assert.rejects(x.controller.submit(command),e=>e.code==='outcome-unknown');assert.equal(x.controller.snapshot.state,'outcome-unknown');
  await assert.rejects(x.controller.submit({...command,payload:{remarks:'new'}}),e=>e.code==='outcome-unknown');assert.equal(await x.controller.reconcile(),null);assert.ok(x.controller.snapshot.pending);
});
test('explicit retry sends original payload and operation ID despite external edits',async()=>{
  let tries=0;const x=setup({handler:async(route)=>{if(route==='/inspect')return{uid:'staff',verifiedAt:1,outcome:null};if(++tries===1)throw Error('Lost');return committed;}});
  const draft=structuredClone(command);await assert.rejects(x.controller.submit(draft));draft.payload.remarks='changed while waiting';
  const done=await x.controller.reconcile({retry:true});assert.equal(done.command.payload.remarks,'draft');const submits=x.calls.filter(c=>c.route==='/commands');assert.deepEqual(submits[0].body,submits[1].body);
});
test('committed status reconciliation never sends a second mutation',async()=>{
  const x=setup({handler:async(route,body)=>{if(route==='/inspect')return{uid:'staff',verifiedAt:1,outcome:body.operationId?committed:null};throw Error('Lost');}});
  await assert.rejects(x.controller.submit(command));const done=await x.controller.reconcile();assert.equal(done.result.version,2);assert.equal(x.calls.filter(c=>c.route==='/commands').length,1);
});
test('slow response timeout remains uncertain even if original later succeeds',async()=>{
  let release;const x=setup({timeoutMs:10,handler:async(route)=>route==='/inspect'?{uid:'staff',verifiedAt:1}:new Promise(r=>release=r)});
  await assert.rejects(x.controller.submit(command),e=>e.code==='outcome-unknown');release(committed);await new Promise(r=>setImmediate(r));assert.ok(x.controller.snapshot.pending);assert.equal(x.controller.snapshot.lastSavedAt,null);
});
test('sign-out clears controller; old response cannot update a new session',async()=>{
  let release;const x=setup({handler:async(route)=>route==='/inspect'?{uid:'staff',verifiedAt:1}:new Promise(r=>release=r)});
  const waiting=x.controller.submit(command);await new Promise(r=>setImmediate(r));x.controller.account(null);x.controller.account('other');release(committed);
  await assert.rejects(waiting,e=>e.code==='session-changed');assert.equal(x.controller.snapshot.uid,'other');assert.equal(x.controller.snapshot.lastSavedAt,null);assert.equal(x.controller.snapshot.pending,null);
});
test('server identity mismatch cannot submit',async()=>{
  const x=setup({handler:async()=>({uid:'other',verifiedAt:1})});await assert.rejects(x.controller.submit(command),e=>e.code==='session-changed');assert.equal(x.calls.length,1);
});
test('uncertain operation survives reload by identity only and cannot replay a missing payload',async()=>{
  const saved=new Map(),journal={read:uid=>saved.get(uid),write:(uid,v)=>saved.set(uid,v),clear:uid=>saved.delete(uid)};
  const transport=async(route)=>{if(route==='/inspect')return{uid:'staff',verifiedAt:1,outcome:null};throw Error('Lost');};
  const first=createConfirmedSaves({transport,isOnline:()=>true,journal});first.account('staff');await assert.rejects(first.submit(command));
  assert.equal(JSON.stringify(saved.get('staff')).includes('draft'),false);
  const next=createConfirmedSaves({transport,isOnline:()=>true,journal});next.account('other');assert.equal(next.snapshot.pending,null);next.account('staff');assert.ok(next.snapshot.pending);
  await assert.rejects(next.submit(command),e=>e.code==='outcome-unknown');await assert.rejects(next.reconcile({retry:true}),e=>e.code==='failed-precondition');assert.ok(next.snapshot.pending);
});
test('maintenance, revoked session and missing policy fail before submission',async()=>{
  for(const code of ['unavailable','permission-denied','failed-precondition','unauthenticated']){
    const x=setup({handler:async()=>{throw new SaveError(code,'Unavailable');}});await assert.rejects(x.controller.submit(command),e=>e.code===code);assert.equal(x.calls.filter(c=>c.route==='/commands').length,0);
  }
});
for(const stage of ['preflight','submission','reconciliation'])for(const code of ['permission-denied','unauthenticated','failed-precondition','invalid-argument','aborted','already-exists','unavailable','network-error','outcome-unknown','internal'])test(`fault matrix: ${stage} / ${code}`,async()=>{
  const before=structuredClone(command);let lost=false;
  const x=setup({handler:async(route,body)=>{
    if(stage==='preflight')throw new SaveError(code,'Synthetic preflight failure');
    if(route==='/inspect'&&!body.operationId)return{uid:'staff',verifiedAt:1};
    if(stage==='submission')throw new SaveError(code,'Synthetic command failure');
    if(route==='/commands'){lost=true;throw Error('Lost initial response');}
    throw new SaveError(code,'Synthetic reconciliation failure');
  }});
  await assert.rejects(x.controller.submit(command));
  if(stage==='reconciliation'){assert.equal(lost,true);await assert.rejects(x.controller.reconcile());assert.ok(x.controller.snapshot.pending);assert.equal(x.controller.snapshot.state,'outcome-unknown');}
  if(stage==='preflight'){assert.equal(x.calls.filter(c=>c.route==='/commands').length,0);assert.equal(x.controller.snapshot.pending,null);}
  assert.deepEqual(command,before);assert.equal(x.controller.snapshot.lastSavedAt,null);
});
