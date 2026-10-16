// Pure browser/server calculations. Missing values remain missing; no operational writes.
export const rounded=(n,p=2)=>Number(n.toFixed(p));
export const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export const validPeriod=v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const addDate=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const days=(a,b)=>(Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000;
const present=v=>v!==undefined&&v!==null&&v!=='';
const number=(v,max=1e12)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
const active=rows=>rows.filter(r=>!r._archived);
const state=v=>String(v||'').trim().toLowerCase();
const complete=v=>['completed','closed'].includes(state(v));
export function assetEnergy(a,defaults={}){
  const invalid=[],missing=[],inferred=[];
  function read(key,fallback,max=1e12){const v=present(a[key])?a[key]:fallback;if(!present(v)){missing.push(key);return null;}if(!number(v,max)){invalid.push(key);return null;}if(!present(a[key]))inferred.push(key);return v;}
  const qty=read('qty',1),hp=present(a.hp)?a.hp:null;
  if(hp!==null&&!number(hp))invalid.push('hp');
  const watts=read('ratedWatts',hp!==null&&number(hp)?hp*746:null),hours=read('opHoursDay',defaults.hours??null,24),operatingDays=read('opDaysMonth',null,31),factor=read('demandFactor',defaults.factor??0.8,1);
  const inputs={qty,ratedWatts:watts,opHoursDay:hours,opDaysMonth:operatingDays,demandFactor:factor};
  const kwh=invalid.length?null:Object.values(inputs).some(v=>v===0)?0:missing.length?null:(watts/1000)*qty*hours*operatingDays*factor;
  return {kwh:kwh!==null&&Number.isFinite(kwh)?rounded(kwh,4):null,inputs,invalid,missing,inferred};
}
export function woForecast(records,asOf){
  if(!validDate(asOf))throw Error('Valid analysis date required');const sections={},excluded=[];
  for(const w of active(records).filter(w=>complete(w.status))){
    let reason=null;
    if(/^PLBG-HI-0001(?:-[A-F0-9]{8})?$/i.test(w.code||''))reason='Pending original date verification';
    else if(!validDate(w.dateStart)||!validDate(w.dateEnd))reason='Invalid or missing dates';
    else if(w.dateEnd<w.dateStart)reason='Completion precedes start';
    else if(w.dateEnd>asOf)reason='Future completion date';
    if(reason){excluded.push({docId:w._docId||w.code||w.id,section:w.section,reason});continue;}
    const s=sections[w.section]||(sections[w.section]={samples:[]});s.samples.push({start:w.dateStart,end:w.dateEnd,duration:days(w.dateStart,w.dateEnd)});
  }
  for(const [section,s]of Object.entries(sections)){s.sampleCount=s.samples.length;s.averageDays=Math.round(s.samples.reduce((n,x)=>n+x.duration,0)/s.sampleCount);s.coverageStart=s.samples.map(x=>x.start).sort()[0];s.coverageEnd=s.samples.map(x=>x.end).sort().at(-1);s.excludedCount=excluded.filter(x=>x.section===section).length;}
  const rows=active(records).filter(w=>['Open','In Progress'].includes(w.status)).map(w=>{
    const s=sections[w.section],projectedDate=s&&validDate(w.dateStart)?addDate(w.dateStart,s.averageDays):null,targetStatus=validDate(w.targetCompletionDate)?w.targetCompletionDate<asOf?'Overdue':'Within target date':'No valid target date';
    return {record:w,averageDays:s?.averageDays??null,sampleCount:s?.sampleCount||0,excludedCount:excluded.filter(x=>x.section===w.section).length,coverageStart:s?.coverageStart||null,coverageEnd:s?.coverageEnd||null,projectedDate,targetStatus,forecastStatus:!s?'Insufficient history':!projectedDate?'Invalid or missing start date':projectedDate<asOf?'Estimate date passed':'Estimated completion',method:'Mean completed calendar days within the same section; rounded to whole days'};
  });return {asOf,rows,sections,excluded};
}
export const WASTE_CATEGORIES=['Infectious','Pathological','Chemical','Pharmaceutical','Sharps','Biodegradable','Recyclable','Residual','FOG','Radioactive'];
export function wasteForecast(records,asOf){
  if(!validDate(asOf))throw Error('Valid analysis date required');const weekday=new Date(asOf+'T00:00:00Z').getUTCDay(),currentMonday=addDate(asOf,-((weekday+6)%7)),windowEnd=addDate(currentMonday,-1),windowStart=addDate(currentMonday,-84);
  const weeks=Array.from({length:12},(_,i)=>({start:addDate(windowStart,i*7),end:addDate(windowStart,i*7+6),values:Object.fromEntries(WASTE_CATEGORIES.map(c=>[c,null]))})),source=active(records),excluded=[];
  let windowRecords=0,supportedRecords=0;
  for(const r of source){
    if(!validDate(r.date)||!number(r.volume)){excluded.push({docId:r._docId||r.id,reason:'Invalid date or volume'});continue;}
    if(r.date<windowStart||r.date>windowEnd){excluded.push({docId:r._docId||r.id,reason:'Outside completed-week analysis window'});continue;}windowRecords++;
    if(!WASTE_CATEGORIES.includes(r.type)){excluded.push({docId:r._docId||r.id,reason:'Unsupported category',category:r.type});continue;}supportedRecords++;
    const week=weeks[Math.floor(days(windowStart,r.date)/7)];week.values[r.type]=(week.values[r.type]??0)+r.volume;
  }
  const categories=WASTE_CATEGORIES.map(type=>{const observations=weeks.map(w=>w.values[type]).filter(v=>v!==null),mean=observations.length?observations.reduce((a,b)=>a+b,0)/observations.length:null;return {type,observedWeeks:observations.length,missingWeeks:12-observations.length,meanKg:mean===null?null:rounded(mean,4),projectedKg:mean===null?null:rounded(mean*1.05,4)};});
  return {asOf,windowStart,windowEnd,weeks,categories,excluded,sourceCount:source.length,windowRecords,supportedRecords,state:!source.length?'No source records':!windowRecords?'No records in analysis window':!supportedRecords?'Unsupported category':'Observed data available',method:'Last 12 completed Monday–Sunday weeks; mean of observed weeks only; next-week +5% heuristic, not a validated prediction'};
}
export function factorCoversPeriod(factor,period){
  if(!factor||!validPeriod(period)||!validDate(factor.validFrom)||factor.validTo!==null&&factor.validTo!==undefined&&!validDate(factor.validTo))return false;
  const first=period+'-01',lastDay=new Date(first+'T00:00:00Z');lastDay.setUTCMonth(lastDay.getUTCMonth()+1,0);const last=lastDay.toISOString().slice(0,10);
  return factor.validFrom<=first&&(!factor.validTo||factor.validTo>=last);
}
export function billCarbon(bill){
  const f=bill._factorSnapshot;if(!f||f.verified!==true||!f.factorId||!Number.isSafeInteger(f.version)||f.version<1||f.unit!=='kgCO2e/kWh'||!number(f.valueKgPerKwh,100)||typeof f.source!=='string'||!f.source.trim()||!validDate(f.publishedOn)||!factorCoversPeriod(f,bill.period)||!number(bill.actualKwh))return null;
  return rounded(bill.actualKwh*f.valueKgPerKwh,4);
}
export function energySummary(records,{year,baselineYear}={}){
  const grouped=new Map(),invalid=[];for(const b of active(records)){if(!validPeriod(b.period)||!number(b.actualKwh)||!number(b.billAmount))invalid.push(b._docId||b.id);if(!validPeriod(b.period))continue;if(!grouped.has(b.period))grouped.set(b.period,[]);grouped.get(b.period).push(b);}
  const duplicatePeriods=[...grouped].filter(([,b])=>b.length>1).map(([p])=>p),unique=[...grouped].filter(([,b])=>b.length===1&&number(b[0].actualKwh)&&number(b[0].billAmount)).map(([,b])=>b[0]),selected=unique.filter(b=>b.period.slice(0,4)===String(year));
  const months=Array.from({length:12},(_,i)=>{const period=year+'-'+String(i+1).padStart(2,'0'),bill=selected.find(b=>b.period===period);return {period,actualKwh:bill?.actualKwh??null,billAmount:bill?.billAmount??null,theoreticalKwh:number(bill?.theoreticalKwh)?bill.theoreticalKwh:null,carbonKg:bill?billCarbon(bill):null,bill:bill||null};});
  const pairs=String(year)!==String(baselineYear)?selected.flatMap(b=>{const baseline=unique.find(x=>x.period===baselineYear+b.period.slice(4));return baseline?[{current:b.actualKwh,baseline:baseline.actualKwh}]:[];}):[];
  const current=pairs.reduce((s,x)=>s+x.current,0),baseline=pairs.reduce((s,x)=>s+x.baseline,0),carbons=selected.map(b=>billCarbon(b));
  return {year:String(year),billCount:selected.length,records:selected,months,missingMonths:months.filter(m=>m.bill===null).map(m=>m.period),invalid,duplicatePeriods,totalKwh:selected.length?rounded(selected.reduce((s,b)=>s+b.actualKwh,0)):null,totalAmount:selected.length?selected.reduce((s,b)=>s+Math.round(b.billAmount*100),0)/100:null,carbonCoverage:carbons.filter(v=>v!==null).length,carbonKg:selected.length&&carbons.every(v=>v!==null)?rounded(carbons.reduce((a,b)=>a+b,0),4):null,comparison:pairs.length?{monthCount:pairs.length,currentKwh:rounded(current),baselineKwh:rounded(baseline),reductionPct:baseline>0?rounded((baseline-current)/baseline*100):null,excludedCurrentMonths:selected.length-pairs.length}:null};
}
export function safetyMetrics(records,asOf){
  const rows=active(records),inactiveStates=['resolved','verified','closed'],open=rows.filter(r=>!inactiveStates.includes(state(r.status))),closed=rows.filter(r=>inactiveStates.includes(state(r.status))),durations=closed.filter(r=>validDate(r.date)&&validDate(r.dateClosed)&&r.dateClosed>=r.date&&r.dateClosed<=asOf).map(r=>days(r.date,r.dateClosed));
  return {total:rows.length,active:open.length,inactive:closed.length,criticalHigh:open.filter(r=>['High','Critical'].includes(r.severity)).length,overdue:open.filter(r=>validDate(r.targetDate)&&r.targetDate<asOf).length,resolutionSamples:durations.length,averageResolutionDays:durations.length?rounded(durations.reduce((a,b)=>a+b,0)/durations.length,1):null,activeRecords:open};
}
export function projectMetrics(records,asOf){
  const rows=active(records),budgeted=rows.filter(r=>number(r.budget)&&r.budget>0),weighted=budgeted.length>0,pool=weighted?budgeted:rows;
  function progress(key){const eligible=pool.filter(p=>number(p[key],100)),denominator=eligible.reduce((s,p)=>s+(weighted?p.budget:1),0);return {value:denominator?rounded(eligible.reduce((s,p)=>s+p[key]*(weighted?p.budget:1),0)/denominator):null,count:eligible.length};}
  const physical=progress('physicalPct'),financial=progress('financialPct'),atRisk=rows.filter(p=>!complete(p.status)&&(p.status==='Delayed'||validDate(p.targetDate)&&p.targetDate<asOf)),completionDates=rows.filter(p=>complete(p.status)&&validDate(p.targetDate)&&validDate(p.actualDate)&&p.actualDate<=asOf&&(!validDate(p.startDate)||p.actualDate>=p.startDate));
  const knownRisk=atRisk.filter(p=>number(p.budget));
  return {total:rows.length,physicalPct:physical.value,financialPct:financial.value,physicalIncluded:physical.count,financialIncluded:financial.count,weighting:weighted?'positive-budget weighted':'simple average',excludedFromWeighting:rows.length-pool.length,budgetAtRisk:atRisk.length&&knownRisk.length<atRisk.length?null:knownRisk.reduce((s,p)=>s+Math.round(p.budget*100),0)/100,knownBudgetAtRisk:knownRisk.reduce((s,p)=>s+Math.round(p.budget*100),0)/100,riskBudgetCoverage:knownRisk.length,atRiskCount:atRisk.length,completionDateSamples:completionDates.length,onTimeRate:completionDates.length?rounded(completionDates.filter(p=>p.actualDate<=p.targetDate).length/completionDates.length*100):null};
}
