import {FieldValue} from 'firebase-admin/firestore';
import {sha} from '../scripts/recovery-core.mjs';
import {exactKeys,identifier,requireCondition as check} from './validation.mjs';
import {token} from './relationship-domain.mjs';
export const RELATIONSHIP_COMMANDS=['createLocation','proposeRelationship','approveRelationship','applyRelationship'];
const relationKeys=['workScope','assetDocId','locationId'];
const spatialKeys=['locationId','location','section','roomNumber','roomName','building','floor','department','roomType','assetCode','mainCategory','assetClass','assetType'];
const changed=(a,b,keys)=>keys.some(k=>(a?.[k]??null)!==(b?.[k]??null));
export async function validateWORelationship({db,tx,record,old,reviewed=false}){
  if(old&&!reviewed)check(!changed(old,record,relationKeys),'failed-precondition','Relationship changes require a user-verified administrator proposal');
  check(['asset','room'].includes(record.workScope),'invalid-argument','Explicit reviewed work scope required');
  identifier(record.locationId,'Location ID');const location=await tx.get(db.doc('locations/'+record.locationId));
  check(location.exists&&!location.data()._archived,'invalid-argument','Location unavailable');
  if(record.workScope==='room')check(!record.assetDocId,'invalid-argument','Room work cannot link equipment');
  else{
    identifier(record.assetDocId,'Asset ID');const asset=await tx.get(db.doc('hammsStores/assets/records/'+record.assetDocId));
    check(asset.exists&&!asset.data()._archived,'invalid-argument','Asset unavailable');const a=asset.data();
    check(a.section===record.section,'invalid-argument','Work-order section must match the asset section; administrator review required for exceptions');
    // Existing exact links keep historical location snapshots after an approved asset move.
    if(!old||reviewed)check(a.locationId===record.locationId,'invalid-argument','Asset and work-order locations must match');
    if(!old||reviewed)check(record.asset===undefined||record.asset===a.name,'invalid-argument','Asset display snapshot does not match selected ID');
  }
  if(!old||reviewed)check(!record.location||record.location===location.data().name,'invalid-argument','Location display snapshot does not match selected ID');
  else check(!changed(old,record,['asset','location']),'failed-precondition','Historical display snapshots are read-only; use reviewed relationship correction');
}
export async function validateAssetRelationship({db,tx,record,old,docId}){
  if(old){const attempted=spatialKeys.filter(k=>(old[k]??null)!==(record[k]??null));check(!attempted.length,'failed-precondition','Asset location, code and classification changes require a reviewed proposal: '+attempted.join(', '));}
  if(!old){identifier(record.locationId,'Location ID');const loc=await tx.get(db.doc('locations/'+record.locationId));check(loc.exists&&!loc.data()._archived&&record.location===loc.data().name,'invalid-argument','Select a registered exact location');}
  if(token(record.assetCode)&&(!old||record.assetCode!==old.assetCode)){
    const all=await tx.get(db.collection('hammsStores/assets/records'));
    check(!all.docs.some(d=>d.id!==docId&&token(d.data().assetCode)===token(record.assetCode)),'already-exists','Asset code already exists, including archived records');
    const unique=db.doc('assetCodes/'+sha(token(record.assetCode)));check(!(await tx.get(unique)).exists,'already-exists','Asset code reserved');
    return ()=>tx.create(unique,{assetDocId:docId,code:record.assetCode});
  }
  return ()=>{};
}
export async function prepareRelationship({db,tx,body,actor,opKey,stampRecord}){
  const now=FieldValue.serverTimestamp,p=body.payload,writes=[];let result,target,auditDetail=null,beforeVersion=null,afterVersion=null;
  async function dependency(ref){const snap=await tx.get(ref);check(snap.exists,'not-found','Relationship dependency missing');return {ref,snap,data:snap.data(),hash:sha(snap.data())};}
  if(body.command==='createLocation'){
    exactKeys(p,['name','aliases','parentId','aliasesVerified','verificationReference']);identifier(body.docId);check(body.expectedVersion===0,'invalid-argument','New location version must be zero');
    check(typeof p.name==='string'&&p.name.trim()&&p.name.length<=300&&Array.isArray(p.aliases)&&p.aliases.length<=30&&p.aliases.every(a=>typeof a==='string'&&a.trim()&&a.length<=300),'invalid-argument','Invalid location or aliases');
    if(p.aliases.length)check(p.aliasesVerified===true&&typeof p.verificationReference==='string'&&p.verificationReference.trim()&&p.verificationReference.length<=1000,'invalid-argument','Explicit alias verification evidence required');
    const all=(await tx.get(db.collection('locations'))).docs.map(d=>({docId:d.id,...d.data()}));check(!all.some(l=>l.docId===body.docId),'already-exists','Location exists; existing definitions require reviewed migration');
    if(p.parentId!==undefined&&p.parentId!==null)identifier(p.parentId,'Parent location ID');
    const names=[p.name,...p.aliases].map(token);check(new Set(names).size===names.length,'invalid-argument','Duplicate location aliases');
    check(!all.some(l=>[l.name,...(l.aliases||[])].some(n=>names.includes(token(n)))),'already-exists','Location name or alias already belongs to another location');
    if(p.parentId){identifier(p.parentId);check(all.some(l=>l.docId===p.parentId&&!l._archived),'invalid-argument','Parent location unavailable');let id=p.parentId;const seen=new Set([body.docId]);while(id){check(!seen.has(id),'invalid-argument','Location hierarchy cycle');seen.add(id);id=all.find(l=>l.docId===id)?.parentId;}}
    const ref=db.doc('locations/'+body.docId);writes.push(()=>tx.create(ref,{name:p.name.trim(),aliases:p.aliases.map(a=>a.trim()),parentId:p.parentId||null,_v:1,createdBy:actor.uid,createdAt:now(),verificationReference:p.verificationReference||null}));target=ref.path;afterVersion=1;result={status:'committed',docId:ref.id,version:1,resource:'location'};
  }else if(body.command==='proposeRelationship'){
    exactKeys(p,['patch','evidence','ownerUid']);check(['wo','assets'].includes(body.store),'invalid-argument','WO link or asset move only');identifier(body.docId);identifier(p.ownerUid);
    check(typeof p.evidence==='string'&&p.evidence.trim()&&p.evidence.length<=4000,'invalid-argument','Source evidence required');
    const owner=(await dependency(db.doc('staff/'+p.ownerUid))).data;check(owner.active&&owner.role==='admin'&&owner.facilityId==='dopmc','invalid-argument','Assign an active administrator as review owner');
    const original=await dependency(db.doc(`hammsStores/${body.store}/records/${body.docId}`));check(original.data._v===body.expectedVersion&&Number.isSafeInteger(original.data._v)&&original.data._docId===body.docId,'aborted','Record identity/version changed or requires separate reviewed migration');
    const deps=[original];let patch;
    if(body.store==='wo'){
      exactKeys(p.patch,relationKeys);check(['asset','room'].includes(p.patch.workScope),'invalid-argument','Explicit scope required');identifier(p.patch.locationId);
      const loc=await dependency(db.doc('locations/'+p.patch.locationId));deps.push(loc);
      patch={workScope:p.patch.workScope,locationId:p.patch.locationId,location:loc.data.name,assetDocId:p.patch.assetDocId||null,asset:'__room_general__'};
      if(p.patch.workScope==='asset'){identifier(p.patch.assetDocId);const asset=await dependency(db.doc('hammsStores/assets/records/'+p.patch.assetDocId));deps.push(asset);patch.asset=asset.data.name;}
      await validateWORelationship({db,tx,record:{...original.data,...patch},reviewed:true});
    }else{
      exactKeys(p.patch,['locationId']);identifier(p.patch.locationId);const loc=await dependency(db.doc('locations/'+p.patch.locationId));deps.push(loc);check(!loc.data._archived,'invalid-argument','Location archived');
      patch={locationId:p.patch.locationId,location:loc.data.name};
      // Moving an asset leaves WO historical location IDs and snapshots intact.
    }
    const proposalId='relationship_'+opKey.slice(0,32),ref=db.doc('relationshipProposals/'+proposalId);
    const proposal={store:body.store,targetId:body.docId,status:'pending',_v:1,patch,evidence:p.evidence,ownerUid:p.ownerUid,createdBy:actor.uid,createdAt:now(),dependencies:deps.map(d=>({path:d.ref.path,hash:d.hash})),before:Object.fromEntries(Object.keys(patch).map(k=>[k,original.data[k]??null]))};
    writes.push(()=>tx.create(ref,proposal));target=ref.path;afterVersion=1;result={status:'committed',docId:body.docId,proposalId,version:original.data._v,relatedStores:[body.store]};auditDetail={proposalId,patch};
  }else{
    identifier(body.docId);const proposalRef=db.doc('relationshipProposals/'+body.docId),proposal=(await dependency(proposalRef)).data;
    check(body.store===proposal.store&&proposal._v===body.expectedVersion,'aborted','Proposal changed');beforeVersion=proposal._v;afterVersion=proposal._v+1;
    const deps=[];for(const expected of proposal.dependencies){const current=await dependency(db.doc(expected.path));check(current.hash===expected.hash,'aborted','Approved preview is stale; regenerate and verify');deps.push(current);}
    const owner=(await dependency(db.doc('staff/'+proposal.ownerUid))).data;check(owner.active&&owner.role==='admin'&&owner.facilityId==='dopmc','permission-denied','Review owner is no longer active');
    if(body.command==='approveRelationship'){
      exactKeys(p,['userVerified','verificationReference']);check(proposal.status==='pending'&&p.userVerified===true&&typeof p.verificationReference==='string'&&p.verificationReference.trim()&&p.verificationReference.length<=1000,'failed-precondition','Explicit user verification and evidence reference required');
      writes.push(()=>tx.update(proposalRef,{status:'approved',_v:afterVersion,userVerified:true,verificationReference:p.verificationReference,approvedBy:actor.uid,approvedAt:now()}));
    }else{
      exactKeys(p,[]);check(proposal.status==='approved'&&proposal.userVerified===true,'failed-precondition','User-verified administrator approval required');
      const approver=(await dependency(db.doc('staff/'+proposal.approvedBy))).data;check(approver.active&&approver.role==='admin'&&approver.facilityId==='dopmc','permission-denied','Approver is no longer an active administrator');
      const original=deps.find(d=>d.ref.path===`hammsStores/${proposal.store}/records/${proposal.targetId}`);check(original&&!original.data._archived,'failed-precondition','Restore archived target before correction');
      if(proposal.store==='wo')await validateWORelationship({db,tx,record:{...original.data,...proposal.patch},reviewed:true});
      writes.push(()=>tx.update(original.ref,stampRecord({...original.data,...proposal.patch},original.ref.id,actor,original.data._v+1)));
      writes.push(()=>tx.update(proposalRef,{status:'applied',_v:afterVersion,appliedBy:actor.uid,appliedAt:now(),operationId:body.operationId}));
    }
    target=proposalRef.path;auditDetail={proposalId:proposalRef.id,before:proposal.before,after:proposal.patch};result={status:'committed',docId:proposal.targetId,proposalId:proposalRef.id,relatedStores:[proposal.store]};
  }
  return {target,result,auditDetail,beforeVersion,afterVersion,write:()=>writes.forEach(w=>w())};
}
