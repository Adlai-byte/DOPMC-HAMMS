import {getStorage} from 'firebase-admin/storage';
import {FieldValue} from 'firebase-admin/firestore';
import {STORES,sha} from '../scripts/recovery-core.mjs';
import {requireCondition as check,exactKeys,identifier} from './validation.mjs';

export const MAX_ATTACHMENT_BYTES=2*1024*1024;
export function validateImage(base64,type){
  check(typeof base64==='string'&&base64.length<=Math.ceil(MAX_ATTACHMENT_BYTES/3)*4,'invalid-argument','Image exceeds 2 MiB limit');const bytes=Buffer.from(base64,'base64');
  check(bytes.length>0&&bytes.length<=MAX_ATTACHMENT_BYTES&&bytes.toString('base64')===base64,'invalid-argument','Invalid image payload');
  const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':false;
  check(valid,'invalid-argument','Only matching PNG/JPEG/WebP image bytes are accepted');return bytes;
}
export function createAttachmentService({app,db,auth,project,requireEmulators}){
  function isolation(){requireEmulators(project);check(process.env.FIREBASE_STORAGE_EMULATOR_HOST==='127.0.0.1:9198'&&(!process.env.STORAGE_EMULATOR_HOST||process.env.STORAGE_EMULATOR_HOST==='http://127.0.0.1:9198'),'failed-precondition','Attachment writes require isolated Storage emulator on 9198');}
  const bucket=()=>{isolation();return getStorage(app).bucket(project+'.appspot.com');};
  async function execute(token,b,options={}){
    isolation();exactKeys(b,['action','operationId','store','docId','expectedVersion','name','contentType','base64','attachmentId','reason','hash','expectedHash','userVerified','verificationReference']);let actor;
    try{actor=await auth.verifyIdToken(token,true);const u=await auth.getUser(actor.uid);check(!u.disabled&&typeof actor.email==='string'&&actor.email.length>0&&u.email===actor.email,'unauthenticated','Active account required');}catch{check(false,'unauthenticated','Active named account required');}
    const membership=async tx=>{const member=(await tx.get(db.doc('staff/'+actor.uid))).data();check(member?.active===true&&['admin','staff'].includes(member.role)&&member.facilityId==='dopmc','permission-denied','Active membership required');return member;};
    if(b.action==='status'){
      identifier(b.operationId);const member=await db.runTransaction(tx=>membership(tx),{readOnly:true}),id=sha({uid:actor.uid,operationId:b.operationId}),metadata=(await db.doc('attachments/'+id).get()).data();return {attachmentId:id,status:metadata?.state||'not-recorded',operationId:b.operationId};
    }
    if(b.action==='reviewPending')return db.runTransaction(async tx=>{const member=await membership(tx);check(member.role==='admin','permission-denied','Administrator required');const rows=await tx.get(db.collection('attachments').where('state','==','pending').limit(100));return {pending:rows.docs.map(d=>({id:d.id,...d.data()})),policy:'Retained for administrator review; no automatic deletion.'};},{readOnly:true});
    if(b.action==='archivePending')return db.runTransaction(async tx=>{
      const member=await membership(tx);check(member.role==='admin','permission-denied','Administrator required');identifier(b.attachmentId);check(b.userVerified===true&&typeof b.verificationReference==='string'&&b.verificationReference.trim().length>=8&&typeof b.reason==='string'&&b.reason.trim(),'invalid-argument','User-verified pending preview and reason required');
      check(b.reason.length<=1000&&b.verificationReference.length<=1000,'invalid-argument','Review reference/reason too long');const policy=(await tx.get(db.doc('system/writePolicy'))).data();check(policy?.maintenance===false,'unavailable','Maintenance active');
      const ref=db.doc('attachments/'+b.attachmentId),outcomeRef=db.doc('operationResults/orphan_'+b.attachmentId),old=(await tx.get(ref)).data(),previous=(await tx.get(outcomeRef)).data();if(previous){check(previous.requestHash===sha(b),'already-exists','This review already completed with a different request');return previous.result;}
      check(old?.state==='pending'&&old.requestHash===b.expectedHash,'aborted','Pending upload changed; review latest metadata');const result={status:'retained-orphan',attachmentId:b.attachmentId,policy:'Binary and metadata retained indefinitely; no file deleted.'};tx.update(ref,{state:'retained-orphan',reviewedBy:actor.uid,reviewReason:b.reason,verificationReference:b.verificationReference,reviewedAt:FieldValue.serverTimestamp()});tx.create(db.doc('auditEvents/orphan_'+b.attachmentId),{command:'retainOrphanImage',actorUid:actor.uid,target:ref.path,reason:b.reason,verificationReference:b.verificationReference,outcome:'retained',committedAt:FieldValue.serverTimestamp()});tx.create(outcomeRef,{actorUid:actor.uid,requestHash:sha(b),result,committedAt:FieldValue.serverTimestamp()});return result;
    });
    if(b.action==='stageBinary'){
      const member=await db.runTransaction(tx=>membership(tx),{readOnly:true});check(member.role==='admin','permission-denied','Administrator required');identifier(b.attachmentId);check(/^[a-f0-9]{64}$/.test(b.attachmentId),'invalid-argument','Original attachment identity required');const bytes=validateImage(b.base64,b.contentType);check(sha(b.base64)===b.hash,'invalid-argument','Binary manifest hash mismatch');
      const file=bucket().file('attachments/'+b.attachmentId),[exists]=await file.exists();
      if(exists){const [existing]=await file.download();check(sha(existing.toString('base64'))===b.hash,'already-exists','Refusing to overwrite a different existing binary');}
      else await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:b.contentType,cacheControl:'private,no-store'}});
      const [readback]=await file.download();check(sha(readback.toString('base64'))===b.hash,'failed-precondition','Staged binary verification failed');
      await db.runTransaction(async tx=>{const member=await membership(tx);check(member.role==='admin','permission-denied','Administrator required');const ref=db.doc('auditEvents/stageBinary_'+b.attachmentId),old=await tx.get(ref);if(!old.exists)tx.create(ref,{command:'stageAttachmentBinary',target:'attachments/'+b.attachmentId,actorUid:actor.uid,hash:b.hash,outcome:'staged',reason:'Isolated binary recovery staging; final record import requires verified preview',committedAt:FieldValue.serverTimestamp()});});return {status:'staged',attachmentId:b.attachmentId,hash:b.hash};
    }
    if(['list','read','readBackup'].includes(b.action))return db.runTransaction(async tx=>{
      const member=await membership(tx);if(b.action==='readBackup')check(member.role==='admin','permission-denied','Administrator required');const p=(await tx.get(db.doc('system/writePolicy'))).data();check(p?.maintenance===false,'unavailable','Maintenance active');
      if(b.action==='list'){check(STORES.includes(b.store),'invalid-argument','Unknown store');identifier(b.docId);const recordPath=`hammsStores/${b.store}/records/${b.docId}`;check((await tx.get(db.doc(recordPath))).exists,'not-found','Record missing');const rows=await tx.get(db.collection('attachments').where('recordPath','==',recordPath).where('state','==','attached').limit(100));return {attachments:rows.docs.map(d=>({id:d.id,...d.data()}))};}
      identifier(b.attachmentId);const metadata=(await tx.get(db.doc('attachments/'+b.attachmentId))).data();check(metadata&&(b.action==='readBackup'||metadata.state==='attached')&&(await tx.get(db.doc(metadata.recordPath))).exists,'not-found','Attachment unavailable');
      const [bytes]=await bucket().file(metadata.objectPath).download();check(bytes.length===metadata.size&&sha(bytes.toString('base64'))===metadata.hash,'failed-precondition','Attachment content hash mismatch');return {metadata,base64:bytes.toString('base64')};
    },{readOnly:true});
    check(b.action==='upload','invalid-argument','Unknown attachment action');identifier(b.operationId);check(STORES.includes(b.store),'invalid-argument','Unknown store');identifier(b.docId);check(Number.isSafeInteger(b.expectedVersion)&&b.expectedVersion>0,'invalid-argument','Expected record version required');check(typeof b.name==='string'&&b.name.trim()&&b.name.length<=200&&!/[\x00-\x1f]/.test(b.name),'invalid-argument','Valid display filename required');check(typeof b.reason==='string'&&b.reason.trim()&&b.reason.length<=1000,'invalid-argument','Reason required');
    const bytes=validateImage(b.base64,b.contentType),hash=sha(b.base64),id=sha({uid:actor.uid,operationId:b.operationId}),metadataRef=db.doc('attachments/'+id),objectPath='attachments/'+id,recordPath=`hammsStores/${b.store}/records/${b.docId}`,requestHash=sha({...b,base64:hash});
    const initial=await db.runTransaction(async tx=>{
      await membership(tx);const p=(await tx.get(db.doc('system/writePolicy'))).data(),record=(await tx.get(db.doc(recordPath))).data(),old=(await tx.get(metadataRef)).data();check(p?.maintenance===false,'unavailable','Maintenance active');
      if(old){check(old.requestHash===requestHash,'already-exists','Upload operation reused with different content');if(old.state==='attached')return old;check(old.state==='pending','failed-precondition','This upload was reviewed and retained; use a new operation for a new image');}
      check(record&&!record._archived&&record._v===b.expectedVersion,'aborted','Record changed, archived or missing');if(old)return old;
      const m={recordPath,recordVersion:b.expectedVersion,objectPath,state:'pending',actorUid:actor.uid,name:b.name,contentType:b.contentType,size:bytes.length,hash,requestHash,operationId:b.operationId,reason:b.reason};tx.create(metadataRef,{...m,createdAt:FieldValue.serverTimestamp()});return m;
    });
    if(initial.state==='attached')return {status:'committed',attachmentId:id};
    await bucket().file(objectPath).save(bytes,{resumable:false,metadata:{contentType:b.contentType,cacheControl:'private,no-store'}});
    const [readback]=await bucket().file(objectPath).download();check(sha(readback.toString('base64'))===hash,'failed-precondition','Upload verification failed');
    if(options.afterVerifiedUpload)await options.afterVerifiedUpload(id); // Trusted test-only scheduling hook; never accepted in HTTP bodies.
    if(options.failAfterUpload)throw Error('Synthetic interruption after upload');
    await db.runTransaction(async tx=>{
      await membership(tx);const p=(await tx.get(db.doc('system/writePolicy'))).data(),record=(await tx.get(db.doc(recordPath))).data(),metadata=(await tx.get(metadataRef)).data();
      check(p?.maintenance===false,'unavailable','Maintenance active');check(record&&!record._archived&&record._v===b.expectedVersion,'aborted','Record changed during upload; pending object retained for review');check(metadata?.requestHash===requestHash,'aborted','Attachment metadata changed');check(['pending','attached'].includes(metadata.state),'failed-precondition','This upload was reviewed and retained; it cannot attach');if(metadata.state==='attached')return;
      tx.update(metadataRef,{state:'attached',attachedAt:FieldValue.serverTimestamp()});tx.create(db.doc('auditEvents/attachment_'+id),{command:'attachImage',operationId:b.operationId,actorUid:actor.uid,target:recordPath,attachmentId:id,reason:b.reason,beforeVersion:b.expectedVersion,afterVersion:b.expectedVersion,outcome:'committed',committedAt:FieldValue.serverTimestamp()});tx.create(db.doc('operationResults/attachment_'+id),{actorUid:actor.uid,requestHash,result:{status:'committed',attachmentId:id},committedAt:FieldValue.serverTimestamp()});
    });return {status:'committed',attachmentId:id};
  }
  async function verifyRecords(documents){
    const records=documents.filter(d=>d.path.startsWith('attachments/'));if(!records.length)return [];
    isolation();const verified=[];
    for(const d of records){const value=k=>d.fields[k]?.stringValue??Number(d.fields[k]?.integerValue),id=d.path.split('/')[1];check(value('objectPath')==='attachments/'+id,'invalid-argument','Attachment object path mismatch');
      const [bytes]=await bucket().file(value('objectPath')).download();check(bytes.length===value('size')&&sha(bytes.toString('base64'))===value('hash'),'failed-precondition','Backed-up image bytes/hash do not match metadata');validateImage(bytes.toString('base64'),value('contentType'));verified.push(d.path+'.objectPath');}
    return verified;
  }
  return {execute,verifyRecords};
}
