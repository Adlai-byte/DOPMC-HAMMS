import crypto from 'node:crypto';
import {FieldPath} from 'firebase-admin/firestore';
import {STORES,sha} from '../scripts/recovery-core.mjs';
import {requireCondition as check,exactKeys,identifier,date} from './validation.mjs';

export const READ_PROTOCOL=8;
export const LIST_FIELDS=['id','code','name','description','title','section','location','status','condition','result','emb','date','dateStart','period','qty','qtyIssued','volume','unit','_v','_archived','_updatedAt','assetDocId','locationId'];
export const STATUS_FIELDS={wo:'status',assets:'condition',waste:'emb',safety:'status',projects:'status',waterLogs:'result',effluent:'status',medWasteProd:'status',wwProd:'status'};
export const DATE_FIELDS={wo:'dateStart',assets:'acquired',issuance:'date',waste:'date',safety:'date',projects:'targetDate',waterLogs:'date',waterTank:'dateTime',effluent:'date',medWasteProd:'date',wwProd:'date',censusLog:'date',energyBills:'period'};
export function validateScope(b){
  exactKeys(b,['action','store','pageSize','cursor','filter','includeArchived','docId']);
  check(['dashboard','list','record'].includes(b.action),'invalid-argument','Unknown scoped read');
  if(b.action==='dashboard'){check(Object.keys(b).length===1,'invalid-argument','Dashboard does not accept list filters');return b;}
  check(STORES.includes(b.store),'invalid-argument','Unknown store');
  if(b.action==='record'){identifier(b.docId);check(Object.keys(b).every(k=>['action','store','docId'].includes(k)),'invalid-argument','Invalid record request');return b;}
  const pageSize=b.pageSize??100;check(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=100,'invalid-argument','Page size must be 1–100');
  check(b.includeArchived===undefined||typeof b.includeArchived==='boolean','invalid-argument','Invalid archive filter');
  if(b.cursor!==undefined)check(typeof b.cursor==='string'&&b.cursor.length<4000,'invalid-argument','Invalid cursor');
  const f=b.filter||{};exactKeys(f,['status','section','from','to']);
  check(f.status===undefined||typeof f.status==='string'&&f.status.length<=80,'invalid-argument','Invalid status');check(f.section===undefined||typeof f.section==='string'&&f.section.length<=80,'invalid-argument','Invalid section');
  if(f.status)check(STATUS_FIELDS[b.store],'invalid-argument','This module has no status field');if(f.section)check(['wo','assets','issuance'].includes(b.store),'invalid-argument','This module has no registered section field');
  check([!!f.status,!!f.section,!!(f.from||f.to)].filter(Boolean).length<=1,'invalid-argument','Choose one server filter: status, section, or date range');
  if(f.from||f.to){check(DATE_FIELDS[b.store],'invalid-argument','This store has no declared date filter');const valid=v=>b.store==='energyBills'?typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v):date(v);check((!f.from||valid(f.from))&&(!f.to||valid(f.to))&&(!f.from||!f.to||f.from<=f.to),'invalid-argument','Invalid date range');}
  return {...b,pageSize,filter:f,includeArchived:b.includeArchived===true};
}
export function createScopedReads({db,auth,project,requireEmulators}){
  requireEmulators(project);const secret=crypto.randomBytes(32);
  const sign=raw=>crypto.createHmac('sha256',secret).update(raw).digest('base64url');
  function encode(value){const raw=Buffer.from(JSON.stringify(value)).toString('base64url');return raw+'.'+sign(raw);}
  function decode(cursor,scope,uid){
    try{const [raw,sig,...extra]=cursor.split('.'),wanted=sign(raw);check(!extra.length&&sig?.length===wanted.length&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(wanted)),'invalid-argument','Cursor signature invalid');const value=JSON.parse(Buffer.from(raw,'base64url').toString());check(value.scope===scope&&value.uid===uid&&value.expires>Date.now(),'invalid-argument','Cursor expired or scope/account changed');return value;}catch{check(false,'invalid-argument','Invalid or expired cursor; refresh this list');}
  }
  async function execute(token,input){
    requireEmulators(project);const body=validateScope(input),started=performance.now();let actor;
    try{actor=await auth.verifyIdToken(token,true);const u=await auth.getUser(actor.uid);check(!u.disabled&&typeof actor.email==='string'&&actor.email.length>0&&actor.email===u.email,'unauthenticated','Active named account required');}catch{check(false,'unauthenticated','Active named account required');}
    return db.runTransaction(async tx=>{
      const member=(await tx.get(db.doc('staff/'+actor.uid))).data(),policy=(await tx.get(db.doc('system/writePolicy'))).data();
      check(member?.active===true&&['staff','admin'].includes(member.role)&&member.facilityId==='dopmc','permission-denied','Active membership required');
      check(policy?.maintenance===false,'unavailable','Maintenance active; wait for reconciled data');
      const metrics={documentReads:2,aggregationQueries:0,returnedRecords:0,projected:true};
      const finish=data=>({...data,uid:actor.uid,readAt:Date.now(),metrics:{...metrics,elapsedMs:Math.round((performance.now()-started)*100)/100}});
      if(body.action==='dashboard'){
        const totals={};
        for(const store of STORES){const q=db.collection(`hammsStores/${store}/records`),all=(await tx.get(q.count())).data().count,archived=(await tx.get(q.where('_archived','==',true).count())).data().count;metrics.aggregationQueries+=2;totals[store]={active:all-archived,archived,total:all};}
        return finish({totals,basis:'Complete store counts at one read transaction; includes legacy records without archive flags. Forecasts and weighted metrics require their complete analysis, not this list page.'});
      }
      if(body.action==='record'){
        const snap=await tx.get(db.doc(`hammsStores/${body.store}/records/${body.docId}`));metrics.documentReads++;metrics.returnedRecords=snap.exists?1:0;return finish({record:snap.exists?{...snap.data(),_docId:snap.id}:null});
      }
      const {store,filter,pageSize,includeArchived}=body,scope=sha({store,filter,pageSize,includeArchived}),cursor=body.cursor?decode(body.cursor,scope,actor.uid):null;
      let q=db.collection(`hammsStores/${store}/records`);const field=filter.from||filter.to?DATE_FIELDS[store]:null;
      if(filter.status)q=q.where(STATUS_FIELDS[store],'==',filter.status);if(filter.section)q=q.where('section','==',filter.section);if(filter.from)q=q.where(field,'>=',filter.from);if(filter.to){if(field==='dateTime'){const next=new Date(Date.parse(filter.to+'T00:00:00Z')+86400000).toISOString().slice(0,10);q=q.where(field,'<',next);}else q=q.where(field,'<=',filter.to);}
      if(field)q=q.orderBy(field);q=q.orderBy(FieldPath.documentId());
      if(cursor)q=field?q.startAfter(cursor.value,cursor.id):q.startAfter(cursor.id);
      // Missing archive flags are active legacy data. Bounded scanning avoids a !=
      // filter, which would silently exclude those documents. Empty pages can continue.
      const result=await tx.get(q.select(...LIST_FIELDS,...(field&&!LIST_FIELDS.includes(field)?[field]:[])).limit(pageSize)),records=[];metrics.documentReads+=result.size;
      let last=null,consumed=0;
      for(const snap of result.docs){last=snap;consumed++;const r=snap.data();if(includeArchived||r._archived!==true)records.push({...r,_docId:snap.id});if(records.length===pageSize)break;}
      const hasMore=consumed<result.size||result.size===pageSize;
      const nextCursor=hasMore&&last?encode({uid:actor.uid,scope,id:last.id,...(field?{value:last.get(field)}:{}),expires:Date.now()+15*60000}):null;
      metrics.returnedRecords=records.length;return finish({records,nextCursor,hasMore,scanCount:result.size,coverage:'This page only. Use dashboard counts for complete totals; refresh to see concurrent edits.',filter,store});
    },{readOnly:true});
  }
  return {execute};
}
