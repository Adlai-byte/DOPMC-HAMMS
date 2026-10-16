import {FieldValue} from 'firebase-admin/firestore';
import {sha} from '../scripts/recovery-core.mjs';
import {exactKeys,identifier,requireCondition as check} from './validation.mjs';
import {validDate,factorCoversPeriod,billCarbon} from './analysis-domain.mjs';
export const ENERGY_COMMANDS=['publishEnergyFactor','configureEnergy'];
const numeric=(v,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max;
export async function prepareEnergyCommand({db,tx,body,actor,opKey}){
  const p=body.payload,now=FieldValue.serverTimestamp;let result,target,beforeVersion=null,afterVersion=null,write;
  if(body.command==='publishEnergyFactor'){
    exactKeys(p,['gridRegion','version','valueKgPerKwh','source','publishedOn','validFrom','validTo','sourceVerified']);
    check(text(p.gridRegion,80)&&Number.isSafeInteger(p.version)&&p.version>0&&numeric(p.valueKgPerKwh,100)&&text(p.source,2000)&&validDate(p.publishedOn)&&validDate(p.validFrom)&&(!p.validTo||validDate(p.validTo)&&p.validTo>=p.validFrom)&&p.sourceVerified===true,'invalid-argument','Verified source, dates, region, version and bounded factor required');
    check(p.validTo===null||p.validTo===undefined||validDate(p.validTo),'invalid-argument','Invalid factor end date');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());check(p.publishedOn<=today,'invalid-argument','Source publication cannot be in the future');
    const ref=db.doc('energyFactors/factor_'+opKey.slice(0,32)),versionRef=db.doc('energyFactorVersions/'+sha(p.gridRegion.trim().toLowerCase()+'/'+p.version));check(!(await tx.get(versionRef)).exists,'already-exists','Factor version already published for this region');
    const record={gridRegion:p.gridRegion.trim(),version:p.version,valueKgPerKwh:p.valueKgPerKwh,source:p.source.trim(),publishedOn:p.publishedOn,validFrom:p.validFrom,validTo:p.validTo||null,verified:true,unit:'kgCO2e/kWh',publishedBy:actor.uid,createdAt:now()};
    write=()=>{tx.create(ref,record);tx.create(versionRef,{factorId:ref.id,createdAt:now()});};target=ref.path;afterVersion=1;result={status:'committed',resource:'energyFactor',docId:ref.id};
  }else{
    exactKeys(p,['gridRegion','baselineYear','targetReductionPct','factorId']);check(text(p.gridRegion,80)&&Number.isSafeInteger(p.baselineYear)&&p.baselineYear>=1900&&p.baselineYear<=2200&&numeric(p.targetReductionPct,100),'invalid-argument','Valid baseline, target and region required');
    const ref=db.doc('energySettings/current'),old=(await tx.get(ref)).data();beforeVersion=old?._v||0;check(body.expectedVersion===beforeVersion,'aborted','Shared settings changed; review latest settings');
    if(p.factorId!==null){identifier(p.factorId);const factor=(await tx.get(db.doc('energyFactors/'+p.factorId))).data();check(factor?.verified===true&&factor.gridRegion===p.gridRegion.trim(),'invalid-argument','Choose a verified factor for the selected region');}
    afterVersion=beforeVersion+1;write=()=>tx.set(ref,{...p,gridRegion:p.gridRegion.trim(),_v:afterVersion,updatedBy:actor.uid,updatedAt:now()});target=ref.path;result={status:'committed',resource:'energySettings',docId:'current',version:afterVersion};
  }
  return {target,result,beforeVersion,afterVersion,auditDetail:null,write};
}
export async function prepareBill({db,tx,record,old,docId}){
  check(!old||record.period===old.period,'failed-precondition','Existing billing period is read-only; reviewed correction required');
  const periodRef=db.doc('energyBillPeriods/dopmc_'+record.period),reserved=await tx.get(periodRef);
  check(!reserved.exists||reserved.data().billDocId===docId,'already-exists','Facility bill already exists for '+record.period+'; edit or restore it');
  const existing=await tx.get(db.collection('hammsStores/energyBills/records').where('period','==',record.period));
  check(!existing.docs.some(d=>d.id!==docId),'already-exists','Existing or archived facility bill already uses this period; review duplicates');
  let factorSnapshot=old?._factorSnapshot??null,settingsSnapshot=old?._energySettingsSnapshot??null;
  if(!old){
    const settings=(await tx.get(db.doc('energySettings/current'))).data();settingsSnapshot=settings?{baselineYear:settings.baselineYear,targetReductionPct:settings.targetReductionPct,gridRegion:settings.gridRegion,version:settings._v||0}:null;
    if(settings?.factorId){const factor=(await tx.get(db.doc('energyFactors/'+settings.factorId))).data();if(factor?.verified===true&&factor.gridRegion===settings.gridRegion&&factorCoversPeriod(factor,record.period)){factorSnapshot={factorId:settings.factorId,gridRegion:factor.gridRegion,version:factor.version,valueKgPerKwh:factor.valueKgPerKwh,source:factor.source,publishedOn:factor.publishedOn,validFrom:factor.validFrom,validTo:factor.validTo,unit:factor.unit,verified:true};}}
  }
  const fields={_factorSnapshot:factorSnapshot,_energySettingsSnapshot:settingsSnapshot};fields._carbonKg=billCarbon({...record,...fields});
  return {fields,write:()=>{if(!reserved.exists)tx.create(periodRef,{facilityId:'dopmc',period:record.period,billDocId:docId,createdAt:FieldValue.serverTimestamp()});}};
}
