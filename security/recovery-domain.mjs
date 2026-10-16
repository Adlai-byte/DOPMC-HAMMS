import {STORES,canonical,sha,documentHash} from '../scripts/recovery-core.mjs';
import {requireCondition as check} from './validation.mjs';
import {stampRecoveryFields} from './record-stamps.mjs';

// Recovery never imports credentials, membership, locks or historical command outcomes.
export const MUTABLE=['locations','inventoryLedgers','energySettings'];
export const EVIDENCE=['attachments','assetCodes','numericIdentities','energyFactors','energyFactorVersions','energyBillPeriods','inventoryMovements','auditEvents','archiveSnapshots','correctionProposals','relationshipProposals'];
export const CONTROLS=['staff','system','operationResults','privilegedJobs'];
export const COVERAGE=[...STORES.map(s=>`hammsStores/${s}/records`),...MUTABLE,...EVIDENCE,...CONTROLS,'hammsMeta','hamms'];
export const FORMAT='hamms-firestore-typed-v2';
export const collectionOf=p=>p.split('/').slice(0,-1).join('/');
export const operational=p=>STORES.some(s=>p.startsWith(`hammsStores/${s}/records/`));
export const restorable=p=>operational(p)||MUTABLE.includes(collectionOf(p))||['hammsMeta/state','hamms/mainData'].includes(p);
export function recoveryStamp(fields,path,actor,at,minimumVersion=0){
  if(operational(path))return stampRecoveryFields(fields,path,actor,at,minimumVersion);
  if(collectionOf(path)==='energySettings')return {...fields,_v:{integerValue:String(Math.max(Number(scalar(fields._v)||0),minimumVersion)+1)},updatedBy:{stringValue:actor.uid},updatedAt:{timestampValue:at}};
  return fields;
}
export const digest=docs=>sha(docs.map(d=>({path:d.path,hash:documentHash(d)})).sort((a,b)=>a.path.localeCompare(b.path)));
export const scalar=v=>v?.stringValue??v?.booleanValue??(v?.integerValue!==undefined?Number(v.integerValue):v?.doubleValue??null);
const invalid=m=>check(false,'invalid-argument',m);
export function validateValue(v,project,depth=0){
  check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1&&depth<24,'invalid-argument','Invalid typed Firestore value');
  const [k]=Object.keys(v),x=v[k];
  if(k==='stringValue')check(typeof x==='string','invalid-argument','Invalid string');
  else if(k==='booleanValue')check(typeof x==='boolean','invalid-argument','Invalid boolean');
  else if(k==='nullValue')check(x===null||x==='NULL_VALUE','invalid-argument','Invalid null');
  else if(k==='integerValue'){check(typeof x==='string'&&/^-?\d+$/.test(x),'invalid-argument','Invalid integer');check(BigInt(x)>=-(2n**63n)&&BigInt(x)<2n**63n,'invalid-argument','Integer outside int64');}
  else if(k==='doubleValue')check(typeof x==='number'&&Number.isFinite(x)||['NaN','Infinity','-Infinity'].includes(x),'invalid-argument','Invalid double');
  else if(k==='timestampValue'){
    check(typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(x)&&Number.isFinite(Date.parse(x)),'invalid-argument','Invalid timestamp');
    const fraction=x.match(/\.(\d+)Z$/)?.[1]||'',nanos=Number(fraction.padEnd(9,'0'));
    check(nanos%1000===0,'invalid-argument','Firestore cannot preserve sub-microsecond timestamps');
    const digits=nanos===0?'':'.'+(nanos%1000000===0?String(nanos/1000000).padStart(3,'0'):String(nanos/1000).padStart(6,'0'));
    check(x===x.slice(0,19)+digits+'Z'&&new Date(x).toISOString().slice(0,19)===x.slice(0,19),'invalid-argument','Timestamp must use canonical Firestore precision');
  }
  else if(k==='bytesValue')check(typeof x==='string'&&Buffer.from(x,'base64').toString('base64')===x,'invalid-argument','Invalid bytes');
  else if(k==='referenceValue')check(typeof x==='string'&&x.startsWith(`projects/${project}/databases/(default)/documents/`)&&x.split('/documents/')[1].split('/').length%2===0,'invalid-argument','External/invalid document reference');
  else if(k==='geoPointValue')check(x&&Object.keys(x).sort().join(',')==='latitude,longitude'&&Number.isFinite(x.latitude)&&Math.abs(x.latitude)<=90&&Number.isFinite(x.longitude)&&Math.abs(x.longitude)<=180,'invalid-argument','Invalid geographic point');
  else if(k==='mapValue'){check(x&&Object.keys(x).every(k=>k==='fields'),'invalid-argument','Invalid map');validateFields(x.fields||{},project,depth+1);}
  else if(k==='arrayValue'){check(x&&Object.keys(x).every(k=>k==='values')&&(!x.values||Array.isArray(x.values)),'invalid-argument','Invalid array');for(const y of x.values||[])validateValue(y,project,depth+1);}
  else invalid('Unsupported typed value');
}
export function validateFields(fields,project,depth=0){
  check(fields&&typeof fields==='object'&&!Array.isArray(fields),'invalid-argument','Invalid typed fields');
  for(const [k,v] of Object.entries(fields)){check(k.length>0&&!['__proto__','constructor','prototype'].includes(k),'invalid-argument','Invalid field name');validateValue(v,project,depth);}
}
export function attachments(documents){
  const found=[];
  function visit(v,path,attachment=false){
    if(v.stringValue!==undefined&&attachment&&/^(?:data:|https?:|gs:)/i.test(v.stringValue)){const s=v.stringValue;found.push({field:path,kind:s.startsWith('data:')?'embedded':'external',hash:sha(s),bytes:Buffer.byteLength(s)});}
    for(const [k,x] of Object.entries(v.mapValue?.fields||{}))visit(x,path+'.'+k,attachment||/photo|image|attachment|report/i.test(k));
    for(const [i,x] of (v.arrayValue?.values||[]).entries())visit(x,path+'['+i+']',attachment);
  }
  for(const d of documents){if(collectionOf(d.path)==='attachments')found.push({field:d.path+'.objectPath',kind:'external',hash:scalar(d.fields.hash)||sha(d.fields),bytes:Number(scalar(d.fields.size)||0)});for(const [k,v] of Object.entries(d.fields))visit(v,d.path+'.'+k,/photo|image|attachment|report/i.test(k));}
  return found.sort((a,b)=>a.field.localeCompare(b.field));
}
export function makeBackup(project,documents,readTime=null){
  documents=documents.map(d=>({...d,hash:documentHash(d)})).sort((a,b)=>a.path.localeCompare(b.path));
  return {format:FORMAT,schema:2,project,database:'(default)',readTime,coverage:[...COVERAGE],documents,attachments:attachments(documents),manifest:{documentCount:documents.length,counts:Object.fromEntries(COVERAGE.map(p=>[p,documents.filter(d=>collectionOf(d.path)===p).length])),datasetHash:digest(documents)}};
}
export function validateRecoveryBackup(b,project){
  check(b?.format===FORMAT&&b.schema===2&&b.project===project&&b.database==='(default)'&&Array.isArray(b.documents),'invalid-argument','Complete typed-v2 backup for this isolated project required');
  check(canonical(b.coverage)===canonical(COVERAGE),'invalid-argument','Partial or unknown recovery coverage');
  const seen=new Set();
  for(const d of b.documents){
    check(typeof d.path==='string'&&COVERAGE.includes(collectionOf(d.path))&&!seen.has(d.path)&&!d.path.split('/').some(s=>!s||s==='.'||s==='..')&&Buffer.byteLength(d.path)<1500,'invalid-argument','Invalid/duplicate path');seen.add(d.path);validateFields(d.fields,project);
    check(Buffer.byteLength(JSON.stringify(d.fields))<=900000,'invalid-argument','Document exceeds conservative recovery size limit');
    check(d.hash===documentHash(d),'invalid-argument','Document hash mismatch');
  }
  const expected=makeBackup(project,b.documents,b.readTime);
  check(canonical(b.manifest)===canonical(expected.manifest)&&canonical(b.attachments)===canonical(expected.attachments),'invalid-argument','Manifest or attachment mismatch');
  return b;
}
export function referenceProblems(documents){
  const byPath=new Map(documents.map(d=>[d.path,d])),problems=[];
  const exists=(d,key,prefix)=>{const id=scalar(d.fields[key]);if(id&&!byPath.has(prefix+id))problems.push({path:d.path,field:key,target:prefix+id});};
  const numeric=new Map(),codes=new Map(),periods=new Map();
  for(const d of documents){
    const c=collectionOf(d.path),f=d.fields;
    if(operational(d.path)){
      const id=scalar(f.id);if(id!==null){const key=c+'/'+id;if(numeric.has(key))problems.push({path:d.path,field:'id',target:numeric.get(key)});numeric.set(key,d.path);}
      if(f._docId&&scalar(f._docId)!==d.path.split('/').at(-1))problems.push({path:d.path,field:'_docId',target:'Document identity mismatch'});
    }
    if(c==='hammsStores/wo/records'){
      exists(d,'assetDocId','hammsStores/assets/records/');exists(d,'locationId','locations/');
      const asset=byPath.get('hammsStores/assets/records/'+scalar(f.assetDocId)),scope=scalar(f.workScope);
      if(scope==='asset'&&!scalar(f.assetDocId)||scope==='room'&&scalar(f.assetDocId)||asset&&scalar(f.section)&&scalar(asset.fields.section)&&scalar(f.section)!==scalar(asset.fields.section))problems.push({path:d.path,field:'assetDocId',target:'Scope/section mismatch'});
      for(const line of f.materials?.arrayValue?.values||[]){const inv=scalar(line.mapValue?.fields?.invDocId);if(inv&&!byPath.has('hammsStores/inventory/records/'+inv))problems.push({path:d.path,field:'materials.invDocId',target:inv});}
    }
    if(c==='hammsStores/assets/records'){exists(d,'locationId','locations/');const code=scalar(f.assetCode)?.trim().normalize('NFKC').toUpperCase();if(code){if(codes.has(code))problems.push({path:d.path,field:'assetCode',target:codes.get(code)});codes.set(code,d.path);}}
    if(c==='hammsStores/energyBills/records'){const period=scalar(f.period);if(period){if(periods.has(period))problems.push({path:d.path,field:'period',target:periods.get(period)});periods.set(period,d.path);}}
    if(['hammsStores/issuance/records','inventoryMovements','inventoryLedgers'].includes(c)){exists(d,'invDocId','hammsStores/inventory/records/');exists(d,'woDocId','hammsStores/wo/records/');}
    if(c==='assetCodes'){exists(d,'assetDocId','hammsStores/assets/records/');const asset=byPath.get('hammsStores/assets/records/'+scalar(f.assetDocId));if(asset&&scalar(f.code)!==scalar(asset.fields.assetCode))problems.push({path:d.path,field:'code',target:'Asset code reservation mismatch'});}
    if(c==='energyBillPeriods'){exists(d,'billDocId','hammsStores/energyBills/records/');const bill=byPath.get('hammsStores/energyBills/records/'+scalar(f.billDocId));if(bill&&scalar(f.period)!==scalar(bill.fields.period))problems.push({path:d.path,field:'period',target:'Bill reservation mismatch'});}
    if(c==='energyFactorVersions')exists(d,'factorId','energyFactors/');
    if(c==='energySettings')exists(d,'factorId','energyFactors/');
    if(c==='locations'){
      exists(d,'parentId','locations/');const seen=new Set([d.path]);let next=scalar(f.parentId);
      while(next){const p='locations/'+next;if(seen.has(p)){problems.push({path:d.path,field:'parentId',target:'Location cycle'});break;}seen.add(p);next=scalar(byPath.get(p)?.fields?.parentId);}
    }
    if(c==='numericIdentities'){const path=scalar(f.recordPath);if(path&&!byPath.has(path))problems.push({path:d.path,field:'recordPath',target:path});}
    if(c==='attachments'){const path=scalar(f.recordPath);if(!path||!byPath.has(path))problems.push({path:d.path,field:'recordPath',target:path||'Missing attachment owner'});}
    if(c==='inventoryLedgers'){
      const inv=byPath.get('hammsStores/inventory/records/'+(scalar(f.invDocId)||d.path.split('/').at(-1))),balance=scalar(f.balanceUnits);
      if(inv&&Math.round(Number(scalar(inv.fields.qty))*10000)!==balance)problems.push({path:d.path,field:'balanceUnits',target:'Inventory/ledger mismatch'});
      const rows=documents.filter(m=>collectionOf(m.path)==='inventoryMovements'&&scalar(m.fields.invDocId)===(scalar(f.invDocId)||d.path.split('/').at(-1))).sort((a,b)=>scalar(a.fields.sequence)-scalar(b.fields.sequence));
      let previous=0,sequence=0;for(const m of rows){if(scalar(m.fields.sequence)!==++sequence||scalar(m.fields.beforeUnits)!==previous||scalar(m.fields.afterUnits)!==previous+scalar(m.fields.deltaUnits))problems.push({path:m.path,field:'sequence',target:'Movement chain mismatch'});previous=scalar(m.fields.afterUnits);}
      if(previous!==balance||sequence!==scalar(f.sequence))problems.push({path:d.path,field:'sequence',target:'Ledger/movement mismatch'});
    }
  }
  return problems;
}
export function archiveFields(fields,{uid,email,reason,at,jobId,path}){
  return {...stampRecoveryFields(fields,path,{uid,email},at),_archived:{booleanValue:true},_archivedAt:{timestampValue:at},_archivedBy:{stringValue:uid},_archiveReason:{stringValue:reason},_recoveryJob:{stringValue:jobId}};
}
export function recoveryPlan(before,input,{mode,uid,email,reason,at,jobId,paths=[]}){
  check(['merge','replace','reset','purge'].includes(mode),'invalid-argument','Unknown recovery mode');
  const current=new Map(before.documents.map(d=>[d.path,d])),desired=new Map(before.documents.map(d=>[d.path,d]));
  const changes=[],protectedSettings=[],conflicts=[];
  function change(path,fields,action){const old=current.get(path);const d=fields?{path,fields,hash:documentHash({path,fields})}:null;if(d?.hash===old?.hash)return;if(d)desired.set(path,d);else desired.delete(path);changes.push({path,action,beforeHash:old?.hash||null,afterHash:d?.hash||null,fields:fields||null});}
  if(['merge','replace'].includes(mode)){
    for(const d of input.documents){const c=collectionOf(d.path),old=current.get(d.path);
      if(CONTROLS.includes(c)){if(c==='staff'&&old?.hash!==d.hash)protectedSettings.push(d.path);continue;}
      if(EVIDENCE.includes(c)){
        if(old&&old.hash!==d.hash)conflicts.push(d.path);else if(!old)change(d.path,d.fields,'add-evidence');continue;
      }
      if(restorable(d.path)){
        if(old?.hash!==d.hash){const fields=recoveryStamp(d.fields,d.path,{uid,email},at,Number(scalar(old?.fields?._v)||0));change(d.path,fields,old?'update':'add');}
        if(MUTABLE.includes(c)&&old?.hash!==d.hash)protectedSettings.push(d.path);
      }
    }
    if(mode==='replace'){const incoming=new Set(input.documents.map(d=>d.path));for(const d of before.documents)if(operational(d.path)&&!incoming.has(d.path)&&scalar(d.fields._archived)!==true)change(d.path,archiveFields(d.fields,{uid,email,reason,at,jobId,path:d.path}),'archive-extra');}
  }else if(mode==='reset'){
    for(const d of before.documents)if(operational(d.path)&&scalar(d.fields._archived)!==true)change(d.path,archiveFields(d.fields,{uid,email,reason,at,jobId,path:d.path}),'archive');
  }else{
    check(Array.isArray(paths)&&paths.length>0&&new Set(paths).size===paths.length,'invalid-argument','Explicit unique archive paths required');
    for(const path of paths){const d=current.get(path);check(d&&operational(path)&&scalar(d.fields._archived)===true,'failed-precondition','Purge applies only to specified archived operational records');change(path,null,'purge');}
    // Reservations and immutable accounting evidence are never erased with a record.
    for(const d of before.documents)if(paths.includes(d.path)&&['inventory','issuance','wo'].includes(d.path.split('/')[1]))conflicts.push(d.path);
  }
  const documents=[...desired.values()],unresolved=referenceProblems(documents);
  const preview={mode,baselineHash:before.manifest.datasetHash,sourceHash:input?.manifest.datasetHash||null,counts:Object.fromEntries(['add','update','archive-extra','archive','purge','add-evidence'].map(a=>[a,changes.filter(c=>c.action===a).length])),changes:changes.map(({fields,...c})=>({...c,before:current.get(c.path)?.fields||null,after:fields})),protectedSettings,conflicts,unresolved,externalAttachments:attachments(documents).filter(a=>a.kind==='external'),finalCount:documents.length,finalHash:digest(documents)};
  return {preview,changes,expected:documents.map(d=>({path:d.path,hash:d.hash})),previewHash:sha(preview)};
}
