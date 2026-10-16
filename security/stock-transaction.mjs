import {FieldValue} from 'firebase-admin/firestore';
import {sha} from '../scripts/recovery-core.mjs';
import {requireCondition as check,exactKeys,validateRecord,SCHEMAS,date} from './validation.mjs';
import {units,quantity,materialLines,stockPlan,versions} from './stock-domain.mjs';
import {validateWORelationship} from './relationship-authority.mjs';

// Build all reads/checks before returning a write closure. Caller couples writes to audit/outcome.
export async function prepareStock({db,tx,body,actor,opKey,stampRecord}){
  const cmd=body.command,p=body.payload,now=FieldValue.serverTimestamp;
  const itemRef=id=>db.doc('hammsStores/inventory/records/'+id),woRef=id=>db.doc('hammsStores/wo/records/'+id),issueRef=id=>db.doc('hammsStores/issuance/records/'+id);
  const writes=[];let target,beforeVersion=null,afterVersion=null,result,auditDetail=null;
  async function current(ref,expected){const snap=await tx.get(ref);check(snap.exists,'not-found','Record missing');const r=snap.data();check(r._docId===ref.id&&Number.isSafeInteger(r._v)&&r._v>0&&Number.isSafeInteger(r.id),'failed-precondition','Legacy identity requires reviewed migration');check(r._v===expected,'aborted','Record changed; review latest');return r;}
  async function newIdentity(ref,suffix){const id=parseInt(sha(opKey+'/'+ref.path).slice(0,12),16)+1;const identity=db.doc('numericIdentities/'+id);check(!(await tx.get(identity)).exists,'already-exists','Numeric identity collision');writes.push(()=>tx.create(identity,{recordPath:ref.path}));return id;}
  async function stockChanges(plan,expected,type,extra={}){
    check(plan.length<=30,'invalid-argument','At most 30 distinct inventory items per command');versions(expected,plan.map(x=>x.invDocId));
    for(const line of plan){
      const ref=itemRef(line.invDocId),item=await current(ref,expected[line.invDocId]);check(!item._archived,'failed-precondition','Inventory archived');
      const balance=units(item.qty,{zero:true}),ledgerRef=db.doc('inventoryLedgers/'+line.invDocId),ledger=await tx.get(ledgerRef);
      check(ledger.exists?ledger.data().balanceUnits===balance:balance===0,'failed-precondition','Opening balance review or ledger reconciliation required');
      const after=balance+line.deltaUnits;check(Number.isSafeInteger(after)&&after>=0&&after<=1e13,'failed-precondition','Insufficient stock or invalid resulting balance');
      if(!line.deltaUnits)continue;
      const seq=(ledger.data()?.sequence||0)+1,movementRef=db.doc('inventoryMovements/'+sha(opKey+'/'+line.invDocId));
      const movement={invDocId:line.invDocId,type,deltaUnits:line.deltaUnits,quantityChange:quantity(line.deltaUnits),beforeUnits:balance,afterUnits:after,sequence:seq,operationId:body.operationId,actorUid:actor.uid,reason:body.reason,createdAt:now(),...extra};
      writes.push(()=>tx.update(ref,stampRecord({...item,qty:quantity(after)},ref.id,actor,item._v+1)));
      writes.push(()=>tx.set(ledgerRef,{invDocId:ref.id,openingUnits:ledger.data()?.openingUnits||0,balanceUnits:after,sequence:seq,updatedAt:now()}));
      writes.push(()=>tx.create(movementRef,movement));
    }
  }
  if(cmd==='receiveStock'||cmd==='adjustStock'){
    const delta=units(p.quantity,{signed:cmd==='adjustStock'});
    await stockChanges([{invDocId:body.docId,deltaUnits:delta}],{[body.docId]:body.expectedVersion},cmd==='receiveStock'?'receipt':'adjustment',{reference:p.reference||''});
    target=itemRef(body.docId).path;beforeVersion=body.expectedVersion;afterVersion=body.expectedVersion+1;result={status:'committed',docId:body.docId,version:afterVersion,relatedStores:['inventory']};
  }else if(cmd==='establishOpeningBalance'){
    const ref=itemRef(body.docId),item=await current(ref,body.expectedVersion),ledgerRef=db.doc('inventoryLedgers/'+ref.id);
    check(!item._archived,'failed-precondition','Inventory archived');
    check(!(await tx.get(ledgerRef)).exists,'failed-precondition','Opening balance already established');
    const proposalRef=db.doc('correctionProposals/'+p.proposalId),proposal=(await tx.get(proposalRef)).data();
    const balance=units(item.qty,{zero:true});
    check(proposal?.type==='opening-balance'&&proposal.status==='approved'&&proposal.userVerified===true&&proposal.invDocId===ref.id&&proposal.expectedVersion===item._v&&proposal.recordHash===sha(item)&&proposal.quantityUnits===balance,'failed-precondition','A matching user-verified administrator-approved preview is required');
    const approver=(await tx.get(db.doc('staff/'+proposal.approvedBy))).data();check(approver?.active===true&&approver.role==='admin'&&approver.facilityId==='dopmc','permission-denied','Proposal approver is not an active administrator');
    writes.push(()=>tx.create(ledgerRef,{invDocId:ref.id,openingUnits:balance,balanceUnits:balance,sequence:1,updatedAt:now()}));
    writes.push(()=>tx.create(db.doc('inventoryMovements/'+sha(opKey+'/'+ref.id)),{invDocId:ref.id,type:'opening-balance',deltaUnits:balance,quantityChange:quantity(balance),beforeUnits:0,afterUnits:balance,sequence:1,operationId:body.operationId,actorUid:actor.uid,reason:body.reason,proposalId:p.proposalId,createdAt:now()}));
    writes.push(()=>tx.update(ref,stampRecord(item,ref.id,actor,item._v+1)));writes.push(()=>tx.update(proposalRef,{status:'applied',operationId:body.operationId,appliedAt:now()}));
    target=ref.path;beforeVersion=item._v;afterVersion=item._v+1;result={status:'committed',docId:ref.id,version:afterVersion,relatedStores:['inventory']};
  }else if(cmd==='issueStock'){
    check(typeof p.issuedTo==='string'&&p.issuedTo.trim()&&p.issuedTo.length<=300&&date(p.date),'invalid-argument','Recipient and date required');
    check(p.woRef===undefined||typeof p.woRef==='string'&&p.woRef.length<=300,'invalid-argument','Invalid work-order display reference');
    const ref=issueRef('manual_'+opKey.slice(0,32));const item=await current(itemRef(p.invDocId),p.inventoryVersion);
    await stockChanges([{invDocId:p.invDocId,deltaUnits:-units(p.qty)}],{[p.invDocId]:p.inventoryVersion},'manual-issue',{issuanceDocId:ref.id});
    const id=await newIdentity(ref,'manual');
    const record={id,date:p.date,invDocId:p.invDocId,invId:item.id,description:item.description,category:item.category,unit:item.unit,qtyIssued:p.qty,qtyReturned:0,issuedTo:p.issuedTo,woRef:p.woRef||'',source:'manual',remarks:body.reason};
    if(p.section!==undefined)record.section=p.section;
    writes.push(()=>tx.create(ref,stampRecord(record,ref.id,actor,1)));target=ref.path;afterVersion=1;result={status:'committed',docId:ref.id,version:1,relatedStores:['inventory','issuance']};
  }else if(cmd==='amendManualIssue'){
    const ref=issueRef(body.docId),old=await current(ref,body.expectedVersion);check(old.source==='manual'&&!old._archived,'failed-precondition','Only manual issuances can use this command');
    check(typeof p.issuedTo==='string'&&p.issuedTo.trim()&&p.issuedTo.length<=300&&date(p.date),'invalid-argument','Recipient and date required');
    const delta=units(old.qtyIssued)-units(p.qty);check(units(p.qty)>=units(old.qtyReturned||0,{zero:true}),'failed-precondition','Issued amount cannot be below already-returned quantity');
    if(delta>0)check(p.confirmedReturn===true,'invalid-argument','Physical return confirmation required for a quantity reduction');
    await stockChanges([{invDocId:old.invDocId,deltaUnits:delta}],{[old.invDocId]:p.inventoryVersion},'manual-amendment',{issuanceDocId:ref.id,beforeIssueQty:old.qtyIssued,afterIssueQty:p.qty,confirmedReturn:p.confirmedReturn===true});
    writes.push(()=>tx.update(ref,stampRecord({...old,qtyIssued:p.qty,issuedTo:p.issuedTo,date:p.date,remarks:body.reason,...(p.section!==undefined?{section:p.section}:{}),...(p.woRef!==undefined?{woRef:p.woRef}:{})},ref.id,actor,old._v+1)));
    auditDetail={before:{qty:old.qtyIssued,issuedTo:old.issuedTo,date:old.date},after:{qty:p.qty,issuedTo:p.issuedTo,date:p.date}};
    target=ref.path;beforeVersion=old._v;afterVersion=old._v+1;result={status:'committed',docId:ref.id,version:afterVersion,relatedStores:['inventory','issuance']};
  }else if(cmd==='returnStock'){
    const ref=issueRef(body.docId),old=await current(ref,body.expectedVersion);check(old.source==='manual'&&!old._archived,'failed-precondition','Automatic issuance returns must use the WO workflow');
    const returned=units(old.qtyReturned||0,{zero:true})+units(p.qty),issued=units(old.qtyIssued);check(returned<=issued,'failed-precondition','Cannot return more than issued');
    await stockChanges([{invDocId:old.invDocId,deltaUnits:units(p.qty)}],{[old.invDocId]:p.inventoryVersion},'manual-return',{issuanceDocId:ref.id,confirmedReturn:true});
    writes.push(()=>tx.update(ref,stampRecord({...old,qtyReturned:quantity(returned)},ref.id,actor,old._v+1)));target=ref.path;beforeVersion=old._v;afterVersion=old._v+1;result={status:'committed',docId:ref.id,version:afterVersion,relatedStores:['inventory','issuance']};
  }else{
    const ref=woRef(body.docId||'wo_'+opKey.slice(0,32)),snap=await tx.get(ref),old=snap.exists?await current(ref,body.expectedVersion):null;
    check(old||cmd==='saveWorkOrder'&&!body.docId,'not-found','Work order missing');
    if(old)check(old._stockManaged===true||!(old.materials?.length),'failed-precondition','Legacy material records require reviewed reconciliation');
    beforeVersion=old?._v??null;afterVersion=(old?._v||0)+1;let record={...old};
    if(cmd==='archiveWorkOrder'||cmd==='restoreWorkOrder'||cmd==='reopenWorkOrder'){
      if(cmd==='archiveWorkOrder'){check(!old._archived,'failed-precondition','Already archived');record={...old,_archived:true,_archivedAt:now(),_archivedBy:actor.uid,_archiveReason:body.reason};}
      if(cmd==='restoreWorkOrder'){check(old._archived===true,'failed-precondition','Not archived');record={...old,_archived:false,_restoredAt:now(),_restoredBy:actor.uid};}
      if(cmd==='reopenWorkOrder'){check(!old._archived&&old.status==='Cancelled','failed-precondition','Only active cancelled WOs may reopen');record={...old,status:'Open'};}
      // Archival/reinstatement changes visibility/status only, never physical stock.
    }else{
      check(!old?._archived,'failed-precondition','Restore archived WO first');
      check(old?.status!=='Cancelled','failed-precondition','Administrator must reopen cancelled WO first');
      const before=materialLines((old?.materials||[]).map(m=>({lineId:m.lineId,invDocId:m.invDocId,qty:m.qty,issuedTo:m.issuedTo})));
      let after;
      if(cmd==='cancelWorkOrder'){
        const requested=new Map(p.returns.map(r=>[r.lineId,units(r.qty)]));
        check([...requested.keys()].every(id=>before.some(m=>m.lineId===id)),'invalid-argument','Unknown return line');
        after=before.map(m=>{const remaining=m.units-(requested.get(m.lineId)||0);check(remaining>=0,'failed-precondition','Return exceeds issued quantity');return {...m,units:remaining,qty:quantity(remaining)};}).filter(m=>m.units);
        record={...old,status:'Cancelled'};
      }else{
        after=materialLines(p.materials);exactKeys(p.record,Object.keys(SCHEMAS.wo.fields).filter(k=>k!=='materials'));
        const business=Object.fromEntries(Object.entries(old||{}).filter(([k])=>Object.keys(SCHEMAS.wo.fields).includes(k)&&k!=='materials'));
        const validated=validateRecord('wo',{...business,...p.record,materials:[]});check(validated.status!=='Cancelled','invalid-argument','Use cancellation command with explicit returns');
        await validateWORelationship({db,tx,record:validated,old});
        record={...old,...validated};
      }
      const plan=stockPlan(before,after);
      for(const line of after){const previous=before.find(m=>m.lineId===line.lineId);check(!previous||previous.invDocId===line.invDocId,'invalid-argument','A material line cannot change its inventory identity');}
      if(plan.some(l=>l.deltaUnits>0))check(p.confirmedReturn===true,'invalid-argument','Material reduction requires confirmed physical return');
      // Validate exact existing automatic lines before replacing them; never guess from display codes.
      const existing=(await tx.get(db.collection('hammsStores/issuance/records').where('woDocId','==',ref.id))).docs;
      const active=existing.filter(s=>!s.data()._archived&&s.data().source==='work-order');
      check(existing.every(s=>s.data().source==='work-order'),'failed-precondition','Unexpected legacy/manual linkage requires review');
      check(active.length===before.length,'failed-precondition','Issuance mismatch requires reviewed reconciliation');
      const byLine=new Map();for(const s of active){const row=await current(s.ref,s.data()._v),m=before.find(m=>m.lineId===row.lineId);check(m&&row.invDocId===m.invDocId&&units(row.qtyIssued)===m.units&&!byLine.has(row.lineId),'failed-precondition','Automatic issuance mismatch');byLine.set(row.lineId,s);}
      await stockChanges(plan,p.inventoryVersions,cmd==='cancelWorkOrder'?'wo-cancellation-return':'wo-material-change',{woDocId:ref.id,confirmedReturn:p.confirmedReturn===true});
      const inventory=new Map();for(const line of after)if(!inventory.has(line.invDocId))inventory.set(line.invDocId,(await tx.get(itemRef(line.invDocId))).data());
      record.materials=after.map(line=>{const item=inventory.get(line.invDocId);return {lineId:line.lineId,invDocId:line.invDocId,invId:item.id,qty:line.qty,name:item.description,unit:item.unit,issuedTo:line.issuedTo};});
      record._stockManaged=true;
      auditDetail={beforeMaterials:old?.materials||[],afterMaterials:record.materials,stockDeltas:plan,beforeStatus:old?.status||null,afterStatus:record.status,confirmedReturn:p.confirmedReturn===true};
      for(const previous of active)if(!after.some(m=>m.lineId===previous.data().lineId))writes.push(()=>tx.update(previous.ref,stampRecord({...previous.data(),_archived:true,_archiveReason:body.reason,_archivedAt:now()},previous.id,actor,previous.data()._v+1)));
      for(const line of after){
        const item=inventory.get(line.invDocId),previous=byLine.get(line.lineId),issuance=issueRef('auto_'+sha(ref.id+'/'+line.lineId).slice(0,40));
        const archived=previous?null:await tx.get(issuance);check(!archived?.exists,'failed-precondition','Retired line ID cannot be reused; assign a new line ID');
        const id=previous?previous.data().id:await newIdentity(issuance,line.lineId);
        const row={...(previous?.data()||{}),id,woDocId:ref.id,woRef:record.code||ref.id,section:record.section,invDocId:line.invDocId,invId:item.id,lineId:line.lineId,qtyIssued:line.qty,issuedTo:line.issuedTo,description:item.description,unit:item.unit,category:item.category,source:'work-order',date:previous?.data().date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),remarks:'Auto-deducted via Work Order'};
        if(previous){if(sha(row)!==sha(previous.data()))writes.push(()=>tx.update(previous.ref,stampRecord(row,previous.id,actor,previous.data()._v+1)));}
        else writes.push(()=>tx.create(issuance,stampRecord(row,issuance.id,actor,1)));
      }
    }
    if(!old){check(!snap.exists,'already-exists','Work order exists');record.id=await newIdentity(ref,'wo');record._createdAt=now();record._createdBy=actor.uid;writes.push(()=>tx.create(ref,stampRecord(record,ref.id,actor,afterVersion)));}
    else writes.push(()=>tx.update(ref,stampRecord(record,ref.id,actor,afterVersion)));
    target=ref.path;result={status:'committed',docId:ref.id,version:afterVersion,relatedStores:['wo','inventory','issuance']};
  }
  return {target,beforeVersion,afterVersion,result,auditDetail,write:()=>writes.forEach(w=>w())};
}
