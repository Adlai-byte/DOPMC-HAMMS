import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FieldValue} from 'firebase-admin/firestore';
import {sha,assertPrivateOutput} from '../scripts/recovery-core.mjs';
import {requireCondition as check,exactKeys,identifier} from './validation.mjs';
import {COVERAGE,collectionOf,makeBackup,validateRecoveryBackup,recoveryPlan,digest,recoveryStamp,scalar} from './recovery-domain.mjs';

// This adapter deliberately has no cloud destination. Files are private, durable staging,
// never served as static assets. Control documents and exact typed writes commit together.
export function createRecoveryJobs({db,auth,project,requireEmulators,verifyBinaryRecords=null,root=path.resolve('..','hamms-recovery','emulator-jobs')}){
  requireEmulators(project);root=assertPrivateOutput(root,path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
  const base=`http://127.0.0.1:8186/v1/projects/${project}/databases/(default)/documents`,name=p=>`projects/${project}/databases/(default)/documents/${p}`;
  async function rest(suffix,body){const r=await fetch(base+suffix,{method:'POST',redirect:'error',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();check(r.ok,'unavailable','Recovery emulator request failed: '+(j.error?.status||r.status));return j;}
  async function actor(token){
    let a;try{a=await auth.verifyIdToken(token,true);const u=await auth.getUser(a.uid);check(!u.disabled&&typeof a.email==='string'&&a.email.length>0&&u.email===a.email,'unauthenticated','Active account required');}catch{check(false,'unauthenticated','Active named account required');}
    const m=(await db.doc('staff/'+a.uid).get()).data();check(m?.active===true&&m.role==='admin'&&m.facilityId==='dopmc','permission-denied','Administrator required');return a;
  }
  async function snapshot(){
    const documents=[];let readTime;
    for(const c of COVERAGE){const segments=c.split('/'),collectionId=segments.pop(),parent=segments.length?'/'+segments.join('/'):'';
      const rows=await rest(parent+':runQuery',{structuredQuery:{from:[{collectionId}]},...(readTime?{readTime}:{})});
      readTime??=rows.find(r=>r.readTime)?.readTime;
      for(const r of rows)if(r.document)documents.push({path:r.document.name.split('/documents/')[1],fields:r.document.fields||{}});
    }
    return validateRecoveryBackup(makeBackup(project,documents,readTime),project);
  }
  function file(id,suffix){identifier(id);return path.join(root,id,suffix+'.json');}
  async function writePrivate(id,suffix,data){await fs.mkdir(path.dirname(file(id,suffix)),{recursive:true,mode:0o700});const handle=await fs.open(file(id,suffix),'wx',0o600);try{await handle.writeFile(JSON.stringify(data));await handle.sync();}finally{await handle.close();}}
  async function load(id){const plan=JSON.parse(await fs.readFile(file(id,'plan'),'utf8'));const job=(await db.doc('privilegedJobs/'+id).get()).data();check(job&&sha(plan)===job.planHash,'failed-precondition','Missing or tampered recovery plan');return {plan,job};}
  async function transactControl(a,id,fn){return db.runTransaction(async tx=>{
    const m=(await tx.get(db.doc('staff/'+a.uid))).data(),policy=(await tx.get(db.doc('system/writePolicy'))).data(),job=(await tx.get(db.doc('privilegedJobs/'+id))).data();
    check(m?.active===true&&m.role==='admin'&&m.facilityId==='dopmc','permission-denied','Active administrator required');check(job,'not-found','Job missing');return fn(tx,job,policy);
  });}
  async function stage(a,b){
    exactKeys(b,['action','operationId','mode','backup','paths','reason']);identifier(b.operationId);check(typeof b.reason==='string'&&b.reason.trim()&&b.reason.length<=1000,'invalid-argument','Recovery reason required');
    const id=sha({uid:a.uid,operationId:b.operationId}),requestHash=sha(b),existing=(await db.doc('privilegedJobs/'+id).get()).data();
    if(existing){check(existing.requestHash===requestHash,'already-exists','Operation ID reused');return status(a,id);}
    check(['merge','replace','reset','purge'].includes(b.mode),'invalid-argument','Recovery mode required');
    if(['merge','replace'].includes(b.mode))validateRecoveryBackup(b.backup,project);else check(b.backup===undefined,'invalid-argument','Reset/purge cannot import a backup');
    check(!(await db.doc('system/writePolicy').get()).data()?.maintenance,'unavailable','Cannot stage during maintenance');
    const before=await snapshot(),at=new Date().toISOString().replace('.000Z','Z'),prepared=recoveryPlan(before,b.backup,{mode:b.mode,uid:a.uid,email:a.email,reason:b.reason,at,jobId:id,paths:b.paths});
    if(prepared.preview.externalAttachments.length&&verifyBinaryRecords){const desired=new Map(before.documents.map(d=>[d.path,d]));for(const c of prepared.changes){if(c.fields)desired.set(c.path,{path:c.path,fields:c.fields});else desired.delete(c.path);}const fields=new Set(await verifyBinaryRecords([...desired.values()]));prepared.preview.externalAttachments=prepared.preview.externalAttachments.map(a=>({...a,verified:fields.has(a.field)}));prepared.previewHash=sha(prepared.preview);}
    check(!prepared.preview.conflicts.length&&!prepared.preview.unresolved.length&&!prepared.preview.externalAttachments.some(a=>a.verified!==true),'failed-precondition','Preview has conflicting evidence, unresolved references or unbacked external attachments');
    // Membership is reported but never replaced by importing a data backup.
    const plan={...prepared,before,source:b.backup||null,mode:b.mode,reason:b.reason,actorUid:a.uid,actorEmail:a.email,createdAt:at};
    await writePrivate(id,'plan',plan);
    await db.runTransaction(async tx=>{
      const m=(await tx.get(db.doc('staff/'+a.uid))).data(),policy=(await tx.get(db.doc('system/writePolicy'))).data();check(m?.active&&m.role==='admin'&&m.facilityId==='dopmc','permission-denied','Administrator required');check(policy?.maintenance===false,'unavailable','Maintenance active');
      tx.create(db.doc('privilegedJobs/'+id),{type:'recovery-v2',mode:b.mode,status:'awaiting-verification',actorUid:a.uid,operationId:b.operationId,requestHash,planHash:sha(plan),previewHash:prepared.previewHash,reason:b.reason,cursor:0,total:prepared.changes.length,createdAt:FieldValue.serverTimestamp()});
      tx.create(db.doc('auditEvents/'+id+'_staged'),{command:'stageRecovery',jobId:id,operationId:b.operationId,actorUid:a.uid,reason:b.reason,previewHash:prepared.previewHash,outcome:'staged',committedAt:FieldValue.serverTimestamp()});
    });return status(a,id);
  }
  async function status(a,id){const {plan,job}=await load(id);return {jobId:id,status:job.status,cursor:job.cursor,total:job.total,previewHash:job.previewHash,preview:plan.preview,progressDirection:job.direction||'forward',reconciliation:job.reconciliation||null};}
  async function approve(a,b){
    exactKeys(b,['action','jobId','previewHash','userVerified','verificationReference','reason']);identifier(b.jobId);
    check(b.userVerified===true&&typeof b.verificationReference==='string'&&b.verificationReference.trim().length>=8&&b.verificationReference.length<=1000&&typeof b.reason==='string'&&b.reason.trim()&&b.reason.length<=1000,'invalid-argument','Explicit user verification reference and approval reason required');
    await transactControl(a,b.jobId,(tx,j)=>{check(j.status==='awaiting-verification'&&j.previewHash===b.previewHash,'failed-precondition','Review the exact staged preview');tx.update(db.doc('privilegedJobs/'+b.jobId),{status:'approved',approvedBy:a.uid,userVerified:true,verificationReference:b.verificationReference,approvalReason:b.reason,approvedAt:FieldValue.serverTimestamp()});tx.create(db.doc('auditEvents/'+b.jobId+'_approved'),{command:'approveRecovery',jobId:b.jobId,actorUid:a.uid,reason:b.reason,previewHash:b.previewHash,verificationReference:b.verificationReference,outcome:'approved',committedAt:FieldValue.serverTimestamp()});});return status(a,b.jobId);
  }
  async function start(a,id){
    const {plan}=await load(id);
    await transactControl(a,id,(tx,j,p)=>{check(j.status==='approved'&&p?.maintenance===false&&!p.recoveryJobId,'failed-precondition','Approved job and free maintenance lock required');tx.update(db.doc('system/writePolicy'),{maintenance:true,recoveryJobId:id,updatedBy:a.uid,updatedAt:FieldValue.serverTimestamp()});tx.update(db.doc('privilegedJobs/'+id),{status:'preparing',startedBy:a.uid,startedAt:FieldValue.serverTimestamp()});});
    return prepare(a,id,plan);
  }
  const volatile=['system','auditEvents','archiveSnapshots','operationResults','privilegedJobs'];
  const stable=b=>digest(b.documents.filter(d=>!volatile.includes(collectionOf(d.path))));
  async function prepare(a,id,plan){
    const before=await snapshot();
    if(stable(before)!==stable(plan.before)){
      await transactControl(a,id,(tx,j,p)=>{check(p.recoveryJobId===id,'failed-precondition','Job lock lost');tx.update(db.doc('privilegedJobs/'+id),{status:'stale-preview'});tx.update(db.doc('system/writePolicy'),{maintenance:false,recoveryJobId:FieldValue.delete()});});check(false,'aborted','Data changed after preview; stage a fresh preview');
    }
    if(verifyBinaryRecords){const desired=new Map(before.documents.map(d=>[d.path,d]));for(const c of plan.changes){if(c.fields)desired.set(c.path,{path:c.path,fields:c.fields});else desired.delete(c.path);}await verifyBinaryRecords([...desired.values()]);}
    let verified=before;
    try{await writePrivate(id,'pre-operation',before);}catch(e){if(e.code!=='EEXIST')throw e;verified=JSON.parse(await fs.readFile(file(id,'pre-operation'),'utf8'));check(stable(verified)===stable(before),'failed-precondition','Pre-operation snapshot mismatch');validateRecoveryBackup(verified,project);}
    const readback=JSON.parse(await fs.readFile(file(id,'pre-operation'),'utf8'));validateRecoveryBackup(readback,project);check(readback.manifest.datasetHash===verified.manifest.datasetHash,'failed-precondition','Pre-operation disk verification failed');
    await transactControl(a,id,(tx,j,p)=>{check(p.recoveryJobId===id&&j.status==='preparing','failed-precondition','Job not preparing');tx.update(db.doc('privilegedJobs/'+id),{status:'running',snapshotHash:verified.manifest.datasetHash,snapshotVerified:true,cursor:0});});
    return status(a,id);
  }
  // REST serialization keeps int64, double-vs-integer, bytes, canonical timestamps,
  // reference/GeoPoint/map/array values intact. Never round-trip through JS numbers.
  const typed=x=>x===null?{nullValue:null}:typeof x==='string'?{stringValue:x}:typeof x==='boolean'?{booleanValue:x}:typeof x==='number'?{integerValue:String(x)}:Array.isArray(x)?{arrayValue:{values:x.map(typed)}}:{mapValue:{fields:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typed(v)]))}};
  const fields=x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typed(v)]));
  const decode=f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,v.stringValue??v.booleanValue??(v.integerValue!==undefined?Number(v.integerValue):v.mapValue?decode(v.mapValue.fields||{}):null)]));
  async function step(a,id,{batchSize=100,failAt}={}){
    check(Number.isInteger(batchSize)&&batchSize>=1&&batchSize<=100,'invalid-argument','Batch size must be 1–100');
    let {plan,job}=await load(id);
    if(job.status==='preparing')return prepare(a,id,plan);
    if(['completed','rolled-back'].includes(job.status))return status(a,id);
    check(['running','rolling-back','reconciling'].includes(job.status),'failed-precondition','Job is not resumable');
    if(job.status==='reconciling')return finish(a,id,plan,job);
    if(failAt==='before-batch')throw Error('Synthetic interruption before batch');
    const changes=job.direction==='rollback'?rollbackChanges(plan,job.forwardCursor):plan.changes;
    const chunk=[];let bytes=0;for(const c of changes.slice(job.cursor,job.cursor+batchSize)){const size=Buffer.byteLength(JSON.stringify(c));if(chunk.length&&bytes+size>7000000)break;chunk.push(c);bytes+=size;}
    const transaction=(await rest(':beginTransaction',{})).transaction;
    try{
      const ctrl=['staff/'+a.uid,'system/writePolicy','privilegedJobs/'+id],rows=await rest(':batchGet',{documents:[...ctrl,...chunk.map(c=>c.path)].map(name),transaction});
      const docs=new Map(rows.filter(r=>r.found).map(r=>[r.found.name.split('/documents/')[1],r.found])),member=decode(docs.get(ctrl[0])?.fields||{}),policy=decode(docs.get(ctrl[1])?.fields||{}),live=decode(docs.get(ctrl[2])?.fields||{});
      check(member.active&&member.role==='admin'&&member.facilityId==='dopmc','permission-denied','Administrator no longer active');check(policy.maintenance&&policy.recoveryJobId===id,'failed-precondition','Recovery lock missing');check(live.cursor===job.cursor&&live.status===job.status&&live.planHash===sha(plan),'aborted','Job advanced concurrently');
      const writes=[];
      for(const c of chunk){const old=docs.get(c.path);check((old?sha({path:c.path,fields:old.fields||{}}):null)===c.beforeHash,'aborted','Recovery target changed unexpectedly');writes.push(c.fields?{update:{name:name(c.path),fields:c.fields}}:{delete:name(c.path)});}
      const next=job.cursor+chunk.length,done=next===changes.length;
      writes.push({update:{name:name(ctrl[2]),fields:{...docs.get(ctrl[2]).fields,...fields({cursor:next,status:done?'reconciling':job.status})}}});
      const batchKey=id+'_'+(job.direction||'forward')+'_'+job.cursor;
      writes.push({update:{name:name('auditEvents/'+batchKey),fields:fields({command:'recoveryBatch',target:'privilegedJobs/'+id,jobId:id,planHash:sha(plan),actorUid:a.uid,reason:plan.reason,operationId:job.operationId,direction:job.direction||'forward',from:job.cursor,to:next,records:chunk.map(c=>({path:c.path,beforeVersion:scalar(docs.get(c.path)?.fields?._v),afterVersion:scalar(c.fields?._v),beforeHash:c.beforeHash,afterHash:c.afterHash})),outcome:'committed'})},currentDocument:{exists:false},updateTransforms:[{fieldPath:'committedAt',setToServerValue:'REQUEST_TIME'}]});
      await rest(':commit',{transaction,writes});
    }catch(e){await rest(':rollback',{transaction}).catch(()=>{});throw e;}
    if(failAt==='after-batch')throw Error('Synthetic interruption after committed batch');
    ({job}=await load(id));if(job.status==='reconciling'){if(failAt==='before-finalize')throw Error('Synthetic interruption before finalization');return finish(a,id,plan,job);}return status(a,id);
  }
  function rollbackChanges(plan,forwardCursor){
    const before=new Map(plan.before.documents.map(d=>[d.path,d]));
    // Removing only documents newly introduced by this recovery undoes that approved
    // import. The full original/source payloads remain in the verified private snapshots.
    return plan.changes.slice(0,forwardCursor).reverse().filter(c=>!['auditEvents','archiveSnapshots'].includes(collectionOf(c.path))).map(c=>{
      const original=before.get(c.path)?.fields||null;
      const fields=original?recoveryStamp(original,c.path,{uid:plan.actorUid,email:plan.actorEmail},plan.createdAt,Number(scalar(c.fields?._v)||0)):null;
      return {path:c.path,beforeHash:c.afterHash,afterHash:fields?sha({path:c.path,fields}):null,fields};
    });
  }
  async function rollback(a,id){
    const {plan,job}=await load(id);check(['running','reconciling'].includes(job.status)&&!job.direction,'failed-precondition','Only a locked forward job can roll back');
    const saved=JSON.parse(await fs.readFile(file(id,'pre-operation'),'utf8'));validateRecoveryBackup(saved,project);check(saved.manifest.datasetHash===job.snapshotHash,'failed-precondition','Rollback snapshot hash mismatch');
    await transactControl(a,id,(tx,j,p)=>{check(p?.maintenance&&p.recoveryJobId===id&&j.cursor===job.cursor&&!j.direction,'aborted','Job changed');tx.update(db.doc('privilegedJobs/'+id),{direction:'rollback',forwardCursor:j.cursor,cursor:0,total:rollbackChanges(plan,j.cursor).length,status:'rolling-back',rollbackBy:a.uid,rollbackAt:FieldValue.serverTimestamp()});tx.create(db.doc('auditEvents/'+id+'_rollback-request'),{command:'rollbackRecovery',actorUid:a.uid,jobId:id,reason:plan.reason,outcome:'requested',committedAt:FieldValue.serverTimestamp()});});return status(a,id);
  }
  async function finish(a,id,plan,job){
    const actual=await snapshot(),actualMap=new Map(actual.documents.map(d=>[d.path,d.hash]));
    if(verifyBinaryRecords)await verifyBinaryRecords(actual.documents);
    const rollbackExpected=new Map(plan.before.documents.map(d=>[d.path,{path:d.path,hash:d.hash}]));
    if(job.direction==='rollback')for(const c of rollbackChanges(plan,job.forwardCursor)){if(c.fields)rollbackExpected.set(c.path,{path:c.path,hash:c.afterHash});else rollbackExpected.delete(c.path);}
    const expected=job.direction==='rollback'?[...rollbackExpected.values()]:plan.expected;
    const written=job.direction==='rollback'?rollbackChanges(plan,job.forwardCursor):plan.changes;
    check(written.every(c=>(actualMap.get(c.path)||null)===c.afterHash),'failed-precondition','Written document reconciliation failed; maintenance retained');
    const relevant=expected.filter(d=>!volatile.includes(collectionOf(d.path)));
    check(relevant.every(d=>actualMap.get(d.path)===d.hash),'failed-precondition','Final payload reconciliation failed; maintenance retained');
    const expectedPaths=new Set(relevant.map(d=>d.path)),actualRelevant=actual.documents.filter(d=>!volatile.includes(collectionOf(d.path)));
    check(actualRelevant.length===relevant.length&&actualRelevant.every(d=>expectedPaths.has(d.path)),'failed-precondition','Final count reconciliation failed; maintenance retained');
    const finalState=job.direction==='rollback'?'rolled-back':'completed',result={status:finalState,jobId:id,matchingDocuments:relevant.length,datasetHash:digest(actualRelevant)};
    await transactControl(a,id,(tx,j,p)=>{check(j.status==='reconciling'&&p?.maintenance&&p.recoveryJobId===id,'failed-precondition','Job lock/state changed');tx.update(db.doc('privilegedJobs/'+id),{status:finalState,reconciliation:result,completedAt:FieldValue.serverTimestamp()});tx.update(db.doc('system/writePolicy'),{maintenance:false,recoveryJobId:FieldValue.delete(),updatedBy:a.uid,updatedAt:FieldValue.serverTimestamp()});tx.create(db.doc('auditEvents/'+id+'_outcome'),{command:'finishRecovery',jobId:id,operationId:j.operationId,actorUid:a.uid,reason:plan.reason,outcome:finalState,committedAt:FieldValue.serverTimestamp()});tx.create(db.doc('operationResults/recovery_'+id),{actorUid:a.uid,result,committedAt:FieldValue.serverTimestamp()});});return status(a,id);
  }
  async function execute(token,b,options={}){
    requireEmulators(project);const a=await actor(token);check(b&&typeof b.action==='string','invalid-argument','Recovery action required');
    if(b.action==='snapshot'){exactKeys(b,['action']);return snapshot();}
    if(b.action==='stage')return stage(a,b);
    if(b.action==='approve')return approve(a,b);
    exactKeys(b,['action','jobId']);identifier(b.jobId);
    if(b.action==='status')return status(a,b.jobId);
    if(b.action==='start')return start(a,b.jobId);
    if(b.action==='step')return step(a,b.jobId,options);
    if(b.action==='rollback')return rollback(a,b.jobId);
    check(false,'invalid-argument','Unknown recovery action');
  }
  return {execute};
}
