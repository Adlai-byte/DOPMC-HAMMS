import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {createLocalHarness} from '../scripts/phase3-local-server.mjs';
import {bootstrapApp} from './helpers/emulator-bootstrap.mjs';
import {STORES} from '../scripts/recovery-core.mjs';
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(p*xs.length)-1)];
const summary=xs=>({n:xs.length,p50:percentile(xs,.5),p95:percentile(xs,.95),p99:percentile(xs,.99)});
test('current-size and 10x synthetic baselines plus 30 cold runs per desktop/mobile profile',{timeout:900000},async()=>{
 const harness=await createLocalHarness(),base=await harness.listen(),env=await initializeTestEnvironment({projectId:'demo-hamms-security',firestore:{host:'127.0.0.1',port:8186}}),browser=await chromium.launch(),results=[];
 try{
  const email='performance@example.test';await harness.service.auth.createUser({uid:'phase8-performance',email,password:'Synthetic-Only-123!'});const auth=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Synthetic-Only-123!',returnSecureToken:true})}),token=(await auth.json()).idToken;
  for(const multiplier of [1,10]){
   await env.clearFirestore();await harness.service.db.doc('system/writePolicy').set({maintenance:false});await harness.service.db.doc('staff/phase8-performance').set({active:true,role:'staff',facilityId:'dopmc'});
   const distribution=[36,472,89,110,...Array(11).fill(23)],total=distribution.reduce((a,b)=>a+b,0)*multiplier;assert.equal(total,960*multiplier);
   let batch=harness.service.db.batch(),count=0;
   for(const [storeIndex,store]of STORES.entries())for(let i=0;i<distribution[storeIndex]*multiplier;i++){
    const id=store+'-'+String(i).padStart(6,'0');batch.set(harness.service.db.doc(`hammsStores/${store}/records/${id}`),{id:++count,_docId:id,_v:1,name:'Synthetic '+id,description:'Performance fixture; no real operational data',status:'Open',section:'Electrical',date:'2026-10-01',dateStart:'2026-10-01',qty:0,...(store==='assets'?{imageData:'data:image/png;base64,'+'A'.repeat(3000)}:{})});if(count%300===0){await batch.commit();batch=harness.service.db.batch();}
   }if(count%300)await batch.commit();
   const baselineTimes=[],newTimes=[];let baselineBytes=0,newBytes=0,aggregateQueries=0;
   for(let i=0;i<30;i++){
    let started=performance.now();const old=await harness.service.inspect(token,{load:true});baselineTimes.push(performance.now()-started);baselineBytes=Buffer.byteLength(JSON.stringify(old));
    started=performance.now();const current=await harness.service.catalog(token,{action:'dashboard'});newTimes.push(performance.now()-started);newBytes=Buffer.byteLength(JSON.stringify(current));aggregateQueries=current.metrics.aggregationQueries;assert.equal(Object.values(current.totals).reduce((n,s)=>n+s.total,0),total);
   }
   const result={multiplier,total,fixture:'Synthetic distribution: 36 WO, 472 assets, 89 inventory, 110 issuance, 23 each remaining store; 3000-byte embedded asset field. This matches total scale, not live record contents or exact per-store mix.',server:{baseline:summary(baselineTimes),scoped:summary(newTimes),baselineBytes,scopedBytes:newBytes,payloadReductionPct:100*(1-newBytes/baselineBytes),baselineOperationalDocuments:total,scopedOperationalDocuments:0,scopedAuthorityDocuments:2,aggregationQueries:aggregateQueries,billing:'Aggregation index reads are additional; emulator counters are not a cloud billing measurement.'},profiles:{}};
   for(const profile of ['desktop','mobile']){
    const cold=[],heaps=[],longTasks=[],resources=[],apiBytes=[];
    for(let run=0;run<30;run++){
     const context=await browser.newContext({viewport:profile==='mobile'?{width:390,height:844}:{width:1440,height:1000}}),p=await context.newPage(),cdp=await context.newCDPSession(p);await cdp.send('Performance.enable');
     if(profile==='mobile'){await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
     await p.addInitScript(()=>{window._phase8LongTasks=[];new PerformanceObserver(list=>window._phase8LongTasks.push(...list.getEntries().map(e=>e.duration))).observe({entryTypes:['longtask']});});
     const started=performance.now();await bootstrapApp(p,base,email,{scoped:true});cold.push(performance.now()-started);
     const data=await p.evaluate(()=>({longTasks:window._phase8LongTasks,resources:performance.getEntriesByType('resource').length,bytes:HAMMS_PHASE8.measurements.reduce((n,m)=>n+m.bytes,0)}));longTasks.push(...data.longTasks);resources.push(data.resources);apiBytes.push(data.bytes);const metrics=await cdp.send('Performance.getMetrics');heaps.push(metrics.metrics.find(m=>m.name==='JSHeapUsedSize').value);
     if(run===0){const navigation=[];for(let i=0;i<31;i++){const t=performance.now();await p.evaluate(()=>HAMMS_PHASE8.openStore('assets'));navigation.push(performance.now()-t);}result.profiles[profile]={firstListFetchMs:navigation[0],navigation:summary(navigation.slice(1))};}
     await context.close();
    }
    Object.assign(result.profiles[profile],{coldMs:summary(cold),jsHeapBytes:summary(heaps),resourceCount:summary(resources),apiBytes:summary(apiBytes),longTasksOver200Ms:longTasks.filter(t=>t>200).length,maxLongTaskMs:longTasks.length?Math.max(...longTasks):0,definition:profile==='mobile'?'390×844, Chromium, 150 ms latency, 1.6 Mbit/s down, 0.75 Mbit/s up, 4× CPU slowdown, cleared SW/cache and explicit sign-in':'1440×1000 Chromium on local loopback, cleared SW/cache and explicit sign-in'});
   }
   assert.ok(result.server.payloadReductionPct>=60);results.push(result);await fs.mkdir('test-results/phase8',{recursive:true});await fs.writeFile('test-results/phase8/performance.json',JSON.stringify(results,null,2));
  }
 }finally{await browser.close();await harness.close();await env.cleanup();}
});
