// Browser/server shared, read-only relationship decisions. No fuzzy or description matching.
export const token=v=>typeof v==='string'?v.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():'';
export const locationKey=l=>l.docId||l._docId;
export function resolveLocation(value,locations=[]){
  const direct=locations.filter(l=>locationKey(l)===value&&!l._archived);
  const matches=direct.length?direct:locations.filter(l=>!l._archived&&[l.name,...(l.aliases||[])].some(n=>token(n)&&token(n)===token(value)));
  return {status:matches.length===1?'unique':matches.length?'ambiguous':'missing',ids:matches.map(locationKey),location:matches.length===1?matches[0]:null};
}
export function sameLocation(a,b,locations=[]){
  if(!token(a)||!token(b))return false;
  const x=resolveLocation(a,locations),y=resolveLocation(b,locations);
  if(x.status==='ambiguous'||y.status==='ambiguous')return false;
  if(x.status==='unique'||y.status==='unique')return x.status==='unique'&&y.status==='unique'&&x.ids[0]===y.ids[0];
  return token(a)===token(b);
}
export function classifyWorkOrder(w,assets=[],locations=[]){
  const base={woId:w._docId||String(w.id),archived:!!w._archived},unresolved=(reason,candidates=[])=>({...base,classification:'unresolved',reason,candidateAssetIds:candidates});
  if(w.workScope==='asset'){
    const matches=assets.filter(a=>a._docId===w.assetDocId);
    if(matches.length!==1)return unresolved('dangling-or-ambiguous-asset-id');
    if(!w.locationId||!locations.some(l=>locationKey(l)===w.locationId))return unresolved('missing-or-dangling-location-id');
    return {...base,classification:'linked-asset',assetDocId:w.assetDocId,locationId:w.locationId};
  }
  if(w.workScope==='room'){
    if(w.assetDocId)return unresolved('room-work-cannot-link-equipment');
    if(!w.locationId||!locations.some(l=>locationKey(l)===w.locationId))return unresolved('missing-or-dangling-location-id');
    return {...base,classification:'explicit-room',locationId:w.locationId};
  }
  if(w.assetDocId||w.locationId||w.workScope)return unresolved('incomplete-explicit-scope');
  const location=resolveLocation(w.location,locations);
  if(w.asset==='__room_general__')return {...base,classification:location.status==='unique'?'legacy-room-candidate':'unresolved',reason:'room-scope-needs-verification',candidateLocationIds:location.ids};
  const candidates=assets.filter(a=>{
    if(w.section&&a.section!==w.section)return false;
    const aLoc=a.locationId||a.location;
    if(!sameLocation(w.location,aLoc,locations))return false;
    return w.assetId&&w.assetId===a.id||token(w.asset)&&[a.name,a.assetCode,a.code].some(n=>token(n)===token(w.asset))||token(w.assetCode)&&[a.assetCode,a.code].some(n=>token(n)===token(w.assetCode));
  });
  if(candidates.length===1)return {...base,classification:'legacy-unique-candidate',candidateAssetIds:[candidates[0]._docId],reason:'unique-exact-evidence-still-requires-verification'};
  return unresolved(candidates.length?'ambiguous-equipment':'no-exact-equipment-evidence',candidates.map(a=>a._docId));
}
export function assetHistory(assetDocId,wos,assets,locations,{includeArchived=false}={}){
  const records=[],unresolved=[];
  for(const w of wos){if(!includeArchived&&w._archived)continue;const c=classifyWorkOrder(w,assets,locations);if(c.classification==='linked-asset'&&c.assetDocId===assetDocId)records.push(w);else if(c.classification==='unresolved'||c.classification.startsWith('legacy-'))unresolved.push(c);}
  return {records,unresolved};
}
export function roomHistory(locationId,wos,assets,locations,{includeArchived=false}={}){
  return {records:wos.filter(w=>(includeArchived||!w._archived)&&['linked-asset','explicit-room'].includes(classifyWorkOrder(w,assets,locations).classification)&&w.locationId===locationId)};
}
export function reviewRelationships(data){
  const records=(data.wo||[]).map(w=>({...classifyWorkOrder(w,data.assets||[],data.locations||[]),ownerRole:'admin',reviewStatus:'pending',evidence:{asset:w.asset||null,location:w.location||null,section:w.section||null,assetCode:w.assetCode||null,code:w.code||null}}));
  const byClassification={};for(const r of records)byClassification[r.classification]=(byClassification[r.classification]||0)+1;
  return {format:'hamms-relationship-review-v1',readOnly:true,requiresUserVerification:true,proposedWrites:[],counts:{workOrders:records.length,classified:records.length,assets:(data.assets||[]).length,byClassification},records,limits:['Snapshot evidence is not current approval.','Legacy candidates are excluded from confirmed history until a verified correction is applied.','Descriptions and name fragments never establish a repair relationship.','Named review ownership must be assigned before corrections; ownerRole is a queue, not a named approver.']};
}
export function previewRelationshipImport(store,rows,{assets=[],locations=[],wo=[]}={}){
  const errors=[];if(!['assets','wo'].includes(store)||!Array.isArray(rows)||rows.length>500)return {valid:false,readOnly:true,errors:[{reason:'Unsupported store or more than 500 rows'}],proposedWrites:[]};
  const codes=new Set((store==='assets'?assets.map(a=>a.assetCode):wo.map(w=>w.code)).map(token).filter(Boolean));
  rows.forEach((r,index)=>{
    if(!r||typeof r!=='object'||Array.isArray(r)){errors.push({index,reason:'Invalid row'});return;}
    if(store==='assets'){
      const code=token(r.assetCode);if(!code||codes.has(code))errors.push({index,reason:'Missing or duplicate asset code'});codes.add(code);
      if(!r.locationId||resolveLocation(r.locationId,locations).status!=='unique')errors.push({index,reason:'Missing or invalid location ID'});
    }else{
      const code=token(r.code);if(code&&codes.has(code))errors.push({index,reason:'Duplicate work-order code'});if(code)codes.add(code);
      const c=classifyWorkOrder(r,assets,locations);if(!['linked-asset','explicit-room'].includes(c.classification))errors.push({index,reason:c.reason||'Explicit scope required'});
      if(r.workScope==='asset'){const a=assets.find(a=>a._docId===r.assetDocId);if(a&&(a._archived||a.section!==r.section||a.locationId!==r.locationId))errors.push({index,reason:'Asset section/location does not match'});}
    }
  });return {valid:errors.length===0,readOnly:true,errors,proposedWrites:[]};
}
