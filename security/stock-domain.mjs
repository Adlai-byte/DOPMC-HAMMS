import {exactKeys,identifier,plain,requireCondition as check,SCHEMAS} from './validation.mjs';
export const STOCK_COMMANDS=['receiveStock','adjustStock','issueStock','returnStock','amendManualIssue','saveWorkOrder','cancelWorkOrder','archiveWorkOrder','restoreWorkOrder','reopenWorkOrder','establishOpeningBalance'];
export const ADMIN_STOCK_COMMANDS=['restoreWorkOrder','reopenWorkOrder','establishOpeningBalance'];
export function units(value,{signed=false,zero=false}={}){
  check(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e9&&Number(value.toFixed(4))===value,'invalid-argument','Quantity must be finite with at most four decimal places');
  const n=Math.round(value*10000);
  check((signed||n>=0)&&(zero||n!==0),'invalid-argument','Invalid quantity sign or zero quantity');return n;
}
export const quantity=n=>n/10000;
export function materialLines(lines){
  check(Array.isArray(lines)&&lines.length<=50,'invalid-argument','At most 50 material lines');const seen=new Set();
  return lines.map(line=>{
    exactKeys(line,['lineId','invDocId','qty','issuedTo']);identifier(line.lineId);identifier(line.invDocId);
    check(!seen.has(line.lineId),'invalid-argument','Duplicate material line identity');seen.add(line.lineId);
    check(typeof line.issuedTo==='string'&&line.issuedTo.trim().length>0&&line.issuedTo.length<=300,'invalid-argument','Material recipient required');
    return {...line,units:units(line.qty)};
  });
}
export function totals(lines){const map=new Map();for(const line of lines)map.set(line.invDocId,(map.get(line.invDocId)||0)+line.units);return map;}
export function stockPlan(before,after){
  const old=totals(before),next=totals(after);return [...new Set([...old.keys(),...next.keys()])].sort().map(invDocId=>({invDocId,deltaUnits:(old.get(invDocId)||0)-(next.get(invDocId)||0)}));
}
export function versions(value,ids){
  check(plain(value),'invalid-argument','Expected inventory versions required');exactKeys(value,ids);
  for(const id of ids)check(Number.isSafeInteger(value[id])&&value[id]>0,'invalid-argument','Missing inventory version');return value;
}
export function stockBody(body){
  check(plain(body.payload),'invalid-argument','Command payload required');
  identifier(body.docId||'new');check(Number.isSafeInteger(body.expectedVersion)&&body.expectedVersion>=0,'invalid-argument','Expected record version required');
  if(['issueStock','amendManualIssue'].includes(body.command)){
    if(body.payload.section!==undefined)check(SCHEMAS.issuance.fields.section(body.payload.section),'invalid-argument','Invalid issuance section');
    if(body.payload.woRef!==undefined)check(typeof body.payload.woRef==='string'&&body.payload.woRef.length<=300,'invalid-argument','Invalid display reference');
  }
  if(['receiveStock','adjustStock'].includes(body.command)){
    exactKeys(body.payload,['quantity','reference']);units(body.payload.quantity,{signed:body.command==='adjustStock'});
    if(body.payload.reference!==undefined)check(typeof body.payload.reference==='string'&&body.payload.reference.length<=300,'invalid-argument','Invalid delivery/adjustment reference');
    check(body.store==='inventory'&&body.docId&&body.expectedVersion>0,'invalid-argument','Inventory identity/version required');
  }else if(body.command==='issueStock'){
    exactKeys(body.payload,['invDocId','qty','issuedTo','date','inventoryVersion','woRef','section']);identifier(body.payload.invDocId);units(body.payload.qty);
    check(body.store==='issuance'&&!body.docId&&body.expectedVersion===0,'invalid-argument','New manual issuance expected');
  }else if(body.command==='amendManualIssue'){
    exactKeys(body.payload,['qty','issuedTo','date','inventoryVersion','confirmedReturn','woRef','section']);units(body.payload.qty);
    check(body.store==='issuance'&&body.docId&&body.expectedVersion>0,'invalid-argument','Issuance identity/version required');
  }else if(body.command==='returnStock'){
    exactKeys(body.payload,['qty','confirmedReturn','inventoryVersion']);units(body.payload.qty);check(body.payload.confirmedReturn===true,'invalid-argument','Physical return confirmation required');
    check(body.store==='issuance'&&body.docId&&body.expectedVersion>0,'invalid-argument','Issuance identity/version required');
  }else if(body.command==='saveWorkOrder'){
    exactKeys(body.payload,['record','materials','inventoryVersions','confirmedReturn']);check(plain(body.payload.record),'invalid-argument','Work-order fields required');materialLines(body.payload.materials);
    check(body.store==='wo'&&(body.docId?body.expectedVersion>0:body.expectedVersion===0),'invalid-argument','Invalid work-order identity/version');
  }else if(body.command==='cancelWorkOrder'){
    exactKeys(body.payload,['returns','inventoryVersions','confirmedReturn']);check(Array.isArray(body.payload.returns)&&body.payload.returns.length<=50,'invalid-argument','Return lines required');
    const seen=new Set();for(const r of body.payload.returns){exactKeys(r,['lineId','qty']);identifier(r.lineId);units(r.qty);check(!seen.has(r.lineId),'invalid-argument','Duplicate return line');seen.add(r.lineId);}
    if(body.payload.returns.length)check(body.payload.confirmedReturn===true,'invalid-argument','Physical return confirmation required');
    check(body.store==='wo'&&body.docId&&body.expectedVersion>0,'invalid-argument','Work-order identity/version required');
  }else if(body.command==='establishOpeningBalance'){
    exactKeys(body.payload,['proposalId']);identifier(body.payload.proposalId);check(body.store==='inventory'&&body.docId&&body.expectedVersion>0,'invalid-argument','Inventory identity/version required');
  }else{
    exactKeys(body.payload,[]);check(body.store==='wo'&&body.docId&&body.expectedVersion>0,'invalid-argument','Work-order identity/version required');
  }
}
