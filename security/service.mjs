import http from 'node:http';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {canonical,sha,STORES} from '../scripts/recovery-core.mjs';
import {CommandError,requireCondition as check,exactKeys,identifier,plain,validateRecord,validateMembership,validateEnergySettings,SCHEMAS} from './validation.mjs';

export const SECURITY_PROJECT='demo-hamms-security';
export function requireEmulators(project,env=process.env) {
  check(project===SECURITY_PROJECT&&env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8186'&&env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9098','failed-precondition','Security service is restricted to the isolated local Auth/Firestore emulators');
}
function active(member) {return member?.active===true&&['staff','admin'].includes(member.role)&&member.facilityId==='dopmc';}
function stampRecord(record,docId,actor,version) {
  return {...record,_docId:docId,_v:version,_updatedBy:actor.email,_updatedAt:Date.now(),_committedAt:FieldValue.serverTimestamp()};
}
const commands=['createRecord','updateRecord','archiveRecord','restoreRecord','setMembership','setMaintenance','setEnergySettings','requestRestore','requestReset','requestPurge'];
const administratorCommands=new Set(['restoreRecord','setMembership','setMaintenance','setEnergySettings','requestRestore','requestReset','requestPurge']);
export async function createSecurityService(project=SECURITY_PROJECT) {
  requireEmulators(project);
  const app=initializeApp({projectId:project},'hamms-security-'+crypto.randomUUID());
  const db=getFirestore(app),auth=getAuth(app);
  async function execute(token,body) {
    let actor;
    try {
      actor=await auth.verifyIdToken(token,true);
      const account=await auth.getUser(actor.uid);
      check(!account.disabled&&typeof actor.email==='string'&&account.email===actor.email,'unauthenticated','Active named Firebase account required');
    } catch(e) {throw new CommandError('unauthenticated','Active named Firebase account required');}
    exactKeys(body,['command','operationId','store','docId','expectedVersion','payload','reason','targetUid']);
    check(commands.includes(body.command),'invalid-argument','Unknown command');
    identifier(body.operationId,'Operation ID');
    check(typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.length<=1000,'invalid-argument','A reason is required');
    const command=body.command, adminOnly=administratorCommands.has(command);
    const recordCommand=['createRecord','updateRecord','archiveRecord','restoreRecord'].includes(command);
    if(recordCommand) {
      check(STORES.includes(body.store),'invalid-argument','Unknown store');
      check(Number.isSafeInteger(body.expectedVersion)&&body.expectedVersion>=0,'invalid-argument','Expected version required');
      if(command==='createRecord')check(body.expectedVersion===0&&!body.docId,'invalid-argument','Create requires version zero and server identity');
      else identifier(body.docId,'Document ID');
      if(['createRecord','updateRecord'].includes(command))check(plain(body.payload),'invalid-argument','Payload required');
      else check(body.payload===undefined,'invalid-argument','Lifecycle actions cannot replace a payload');
    }
    const opKey=sha({uid:actor.uid,operationId:body.operationId}),requestHash=sha(body);
    const outcomeRef=db.doc('operationResults/'+opKey),auditRef=db.doc('auditEvents/'+opKey);
    return await db.runTransaction(async tx=>{
      const member=(await tx.get(db.doc('staff/'+actor.uid))).data();
      check(active(member),'permission-denied','Active facility membership required');
      check(!adminOnly||member.role==='admin','permission-denied','Administrator required');
      const policy=(await tx.get(db.doc('system/writePolicy'))).data();
      check(policy&&typeof policy.maintenance==='boolean','failed-precondition','Write policy not provisioned');
      check(!policy.maintenance||command==='setMaintenance','unavailable','Maintenance lock active');
      const existingOutcome=await tx.get(outcomeRef);
      if(existingOutcome.exists) {
        check(existingOutcome.data().requestHash===requestHash,'already-exists','Operation ID reused with a different request');
        return existingOutcome.data().result;
      }
      let result,target,beforeVersion=null,afterVersion=null,write;
      if(recordCommand) {
        const docId=command==='createRecord'?body.store+'_'+opKey.slice(0,32):body.docId;
        const ref=db.doc(`hammsStores/${body.store}/records/${docId}`),snap=await tx.get(ref),old=snap.data();target=ref.path;
        if(command==='createRecord')check(!snap.exists,'already-exists','Record exists');
        else {
          check(snap.exists,'not-found','Record not found');
          check(Number.isSafeInteger(old._v)&&old._v>0&&old._docId===docId&&Number.isSafeInteger(old.id),'failed-precondition','Legacy identity/version requires reviewed migration');
          check(old._v===body.expectedVersion,'aborted','Record changed; review the latest version');
          beforeVersion=old._v;
        }
        check(body.store!=='issuance','failed-precondition','Use the stock transaction command planned for Phase 4');
        check(!(body.store==='inventory'&&['archiveRecord','restoreRecord'].includes(command)),'failed-precondition','Inventory lifecycle requires the stock ledger workflow');
        let record;
        if(['createRecord','updateRecord'].includes(command)) {
          check(!old?._archived,'failed-precondition','Archived record must be restored first');
          const allowed=Object.keys(SCHEMAS[body.store].fields);exactKeys(body.payload,allowed);
          const oldBusiness=Object.fromEntries(Object.entries(old||{}).filter(([k])=>allowed.includes(k)));
          const validated=validateRecord(body.store,{...oldBusiness,...body.payload});
          if(body.store==='inventory') {
            check(command==='createRecord'?validated.qty===0&&(validated.originalQty??0)===0:validated.qty===old.qty&&(validated.originalQty??null)===(old.originalQty??null),'failed-precondition','Stock changes require a movement, not a balance overwrite');
          }
          if(body.store==='wo') {
            check(!(validated.materials?.length||old?.materials?.length),'failed-precondition','Material changes require the Phase 4 stock transaction');
            if(command==='createRecord')check(['room','asset'].includes(validated.workScope),'invalid-argument','Explicit work scope required');
            if(validated.assetDocId) {
              const asset=await tx.get(db.doc('hammsStores/assets/records/'+validated.assetDocId));
              check(asset.exists&&!asset.data()._archived,'invalid-argument','Selected asset is unavailable');
            }
            if(validated.locationId)check((await tx.get(db.doc('locations/'+validated.locationId))).exists,'invalid-argument','Unknown location');
          }
          if(command==='createRecord') {
            const numericId=parseInt(opKey.slice(0,12),16)+1;
            const identity=db.doc('numericIdentities/'+numericId);
            check(!(await tx.get(identity)).exists,'already-exists','Numeric identity collision; resubmit with a new operation ID');
            record={...validated,id:numericId,_createdAt:FieldValue.serverTimestamp(),_createdBy:actor.uid};
            write=()=>{tx.create(identity,{recordPath:ref.path});tx.create(ref,stampRecord(record,docId,actor,1));};
            afterVersion=1;
          } else {
            // Preserve all untouched legacy fields, including those not yet in the candidate schema.
            record={...old,...body.payload};afterVersion=old._v+1;
            write=()=>tx.update(ref,stampRecord(record,docId,actor,afterVersion));
          }
        } else {
          check(!(body.store==='wo'&&old.materials?.length),'failed-precondition','Work-order lifecycle requires material reconciliation');
          const archived=command==='archiveRecord';
          check(archived?!old._archived:old._archived===true,'failed-precondition','Record lifecycle already changed');
          afterVersion=old._v+1;
          record={...old,_archived:archived,...(archived?{_archivedAt:FieldValue.serverTimestamp(),_archivedBy:actor.uid,_archiveReason:body.reason}:{_restoredAt:FieldValue.serverTimestamp(),_restoredBy:actor.uid})};
          write=()=>tx.update(ref,stampRecord(record,docId,actor,afterVersion));
        }
        result={status:'committed',docId,version:afterVersion};
      } else if(command==='setMembership') {
        identifier(body.targetUid,'Target UID');validateMembership(body.payload);
        check(body.targetUid!==actor.uid||(body.payload.role==='admin'&&body.payload.active),'failed-precondition','Use another active administrator to deactivate/demote yourself');
        try {await auth.getUser(body.targetUid);}catch {throw new CommandError('invalid-argument','Target Firebase account does not exist');}
        target='staff/'+body.targetUid;
        write=()=>tx.set(db.doc(target),{...body.payload,updatedBy:actor.uid,updatedAt:FieldValue.serverTimestamp()},{merge:true});
        result={status:'committed',targetUid:body.targetUid};
      } else if(command==='setMaintenance') {
        exactKeys(body.payload,['maintenance']);check(typeof body.payload.maintenance==='boolean','invalid-argument','Maintenance boolean required');
        target='system/writePolicy';write=()=>tx.set(db.doc(target),{maintenance:body.payload.maintenance,updatedBy:actor.uid,updatedAt:FieldValue.serverTimestamp()},{merge:true});result={status:'committed',maintenance:body.payload.maintenance};
      } else if(command==='setEnergySettings') {
        validateEnergySettings(body.payload);target='energySettings/current';
        write=()=>tx.set(db.doc(target),{...body.payload,updatedBy:actor.uid,updatedAt:FieldValue.serverTimestamp()});result={status:'committed'};
      } else {
        // Phase 2 authorizes request submission only. It never executes a restore/reset/purge.
        check(body.payload===undefined,'invalid-argument','Jobs cannot accept replacement record payloads');
        target='privilegedJobs/'+opKey;
        write=()=>tx.create(db.doc(target),{type:command,status:'awaiting-implementation-and-review',actorUid:actor.uid,reason:body.reason,createdAt:FieldValue.serverTimestamp()});
        result={status:'awaiting-implementation-and-review',jobId:opKey};
      }
      write();
      tx.create(auditRef,{actorUid:actor.uid,actorEmail:actor.email,command,target,reason:body.reason,beforeVersion,afterVersion,operationId:body.operationId,committedAt:FieldValue.serverTimestamp()});
      tx.create(outcomeRef,{actorUid:actor.uid,requestHash,result,committedAt:FieldValue.serverTimestamp()});
      return result;
    });
  }
  const codes={'unauthenticated':401,'permission-denied':403,'invalid-argument':400,'not-found':404,'already-exists':409,'aborted':409,'failed-precondition':412,'unavailable':503};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    try {
      check(req.method==='POST'&&req.url==='/commands','invalid-argument','POST /commands required');
      check(req.headers['content-type']?.split(';')[0]==='application/json','invalid-argument','JSON content type required');
      const match=req.headers.authorization?.match(/^Bearer ([^\s]+)$/);check(match,'unauthenticated','Firebase ID token required');
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;check(size<=800000,'invalid-argument','Request too large');chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new CommandError('invalid-argument','Invalid JSON');}
      const result=await execute(match[1],body);res.statusCode=200;res.end(JSON.stringify(result));
    } catch(e) {
      const code=e instanceof CommandError?e.code:'internal';res.statusCode=codes[code]||500;
      res.end(JSON.stringify({error:{code,message:e instanceof CommandError?e.message:'Command failed'}}));
    }
  });
  // The caller can start the test service only on a loopback listener.
  return {execute,db,auth,async listen(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;},async close(){if(server.listening)await new Promise(resolve=>server.close(resolve));await db.terminate();await deleteApp(app);}};
}
