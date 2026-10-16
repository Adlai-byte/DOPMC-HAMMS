import {sha} from '../scripts/recovery-core.mjs';
// Evidence only. Similar rows are never declared safe to delete automatically.
export function reviewStockData(data){
  const findings=[],classifications=[],groups=new Map(),wos=data.wo||[],items=data.inventory||[];
  for(const row of data.issuance||[]){
    const key=row._docId||String(row.id),automatic=row.source==='work-order'||row.remarks==='Auto-deducted via Work Order';
    if(!automatic){classifications.push({issuanceId:key,classification:row.source==='manual'?'managed-manual':'legacy-manual-or-unknown',action:'retain'});continue;}
    const candidates=row.woDocId?wos.filter(w=>w._docId===row.woDocId):wos.filter(w=>[w.code,'WO-'+String(w.id).padStart(4,'0')].includes(row.woRef));
    if(candidates.length!==1){findings.push({kind:'unresolved-work-order-reference',issuanceId:key,candidateCount:candidates.length});classifications.push({issuanceId:key,classification:'unresolved',action:'retain-pending-review'});continue;}
    const wo=candidates[0],woKey=wo._docId||String(wo.id),inv=row.invDocId?items.filter(i=>i._docId===row.invDocId):items.filter(i=>i.id===row.invId);
    if(inv.length!==1){findings.push({kind:'unresolved-inventory-reference',issuanceId:key});classifications.push({issuanceId:key,classification:'unresolved',action:'retain-pending-review'});continue;}
    classifications.push({issuanceId:key,classification:row.source==='work-order'?'managed-work-order':'legacy-work-order',woId:woKey,action:'retain'});
    if(row._archived)continue;
    const group=woKey+'/'+(inv[0]._docId||String(inv[0].id));if(!groups.has(group))groups.set(group,{wo,inventory:inv[0],rows:[]});groups.get(group).rows.push(row);
  }
  for(const group of groups.values()){
    const {wo,inventory,rows}=group;
    const materials=(wo.materials||[]).filter(m=>m.invDocId?m.invDocId===inventory._docId:m.invId===inventory.id);
    const expected=materials.reduce((s,r)=>s+Number(r.qty||0),0),logged=rows.reduce((s,r)=>s+Number(r.qtyIssued||0),0);
    if(rows.length>1||Math.abs(logged-expected)>0.00005)findings.push({kind:'possible-duplicate-or-quantity-mismatch',woId:wo._docId||String(wo.id),inventoryId:inventory._docId||String(inventory.id),issuanceIds:rows.map(r=>r._docId||String(r.id)),materialQuantity:expected,loggedQuantity:logged,explanation:'Multiple rows can represent legitimate separate issues. Verify source records and actual stock before proposing a correction.'});
  }
  const openings=items.map(item=>({inventoryId:item._docId||String(item.id),quantity:item.qty,version:item._v??null,recordHash:sha(item),classification:'opening-balance-review-required',action:'retain-exactly'}));
  return {format:'hamms-stock-review-v1',readOnly:true,requiresUserVerification:true,proposedWrites:[],counts:{inventory:items.length,workOrders:wos.length,issuances:(data.issuance||[]).length,findings:findings.length,classifiedIssuances:classifications.length},findings,issuanceClassifications:classifications,openingBalanceReview:openings,limits:['A snapshot is not a current physical stock count.','No legacy row is deleted, relinked, reclassified or deduplicated.','Opening balance proposals need current record versions, user verification and administrator approval; this report does not approve or apply them.']};
}
