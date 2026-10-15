import {STORES} from '../scripts/recovery-core.mjs';

export class CommandError extends Error {
  constructor(code,message) { super(message); this.code=code; }
}
export function requireCondition(value,code,message) { if(!value) throw new CommandError(code,message); }
const bad = message => { throw new CommandError('invalid-argument',message); };
export function plain(value) {
  return value!==null && typeof value==='object' && !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;
}
export function exactKeys(value,allowed) {
  if(!plain(value))bad('Expected a plain object');
  if(Object.keys(value).some(k=>!allowed.includes(k)||['__proto__','constructor','prototype'].includes(k)))bad('Unknown or protected field');
}
export function identifier(v,label='Identifier') { if(typeof v!=='string'||!/^[-A-Za-z0-9_]{1,120}$/.test(v))bad(label+' is invalid');return v; }
const text=(max=2000)=>v=>typeof v==='string'&&v.length<=max;
const nonempty=(max=2000)=>v=>text(max)(v)&&v.trim().length>0;
const number=(min=0,max=1e12)=>v=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer=(min=0,max=Number.MAX_SAFE_INTEGER)=>v=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const one=values=>v=>values.includes(v);
export const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const optionalDate=v=>v===''||v===null||date(v);
const dateTime=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(v)&&date(v.slice(0,10))&&Number.isFinite(Date.parse(v))&&Number(v.slice(11,13))<24&&Number(v.slice(14,16))<60;
const nullable=fn=>v=>v===null||fn(v);
const bool=v=>typeof v==='boolean';
const array=(fn,max=100)=>v=>Array.isArray(v)&&v.length<=max&&v.every(fn);
const numText=v=>v===''||v===null||number()(v)||(typeof v==='string'&&v.trim()!==''&&number()(Number(v)));
const image=v=>v===null||v===''||(text(700000)(v)&&(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)||/^https:\/\//.test(v)));
const sections=['CMW','Electrical','Plumbing','Mechanical','Housekeeping','Biomedical'];
const common={code:nullable(text(120)),remarks:text(4000)};
function schema(required,fields) {return {required,fields:{...common,...fields}};}
const s=text(), n=nullable(number()), d=optionalDate;
const material=v=>{if(!plain(v))return false;const fields={invId:integer(1),invDocId:identifierValue,lineId:identifierValue,name:s,qty:number(0.0001),unit:text(80),issuedTo:s};return Object.keys(v).every(k=>fields[k]?.(v[k]))&&v.qty!==undefined&&(v.invId!==undefined||v.invDocId!==undefined);};
const identifierValue=v=>typeof v==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(v);
export const SCHEMAS={
  wo:schema(['section','description','status','priority'],{section:one(sections),description:nonempty(4000),asset:s,assetDocId:nullable(identifierValue),location:s,locationId:identifierValue,workScope:one(['asset','room']),priority:one(['Low','Medium','High','Emergency']),status:one(['Open','In Progress','Completed','Closed','Cancelled']),dateStart:d,targetCompletionDate:d,dateEnd:d,assigned:s,materials:array(material,50),delayReason:nullable(s),delayReasonOther:s,serviceReport:image,createdAt:d}),
  assets:schema(['name','section','location'],{name:nonempty(300),section:one(sections),location:nonempty(500),locationId:identifierValue,assetCode:text(120),brand:s,serial:s,serialNumber:s,condition:one(['Good','Fair','Poor','For Repair','Unserviceable','Condemned']),acquired:d,qty:number(),mainCategory:s,assetClass:s,assetType:s,building:s,floor:s,roomNumber:s,roomName:s,department:s,roomType:s,maintFrequency:integer(),lastMaintDate:d,nextMaintDate:d,lastMaint:d,ratedWatts:n,hp:n,opHoursDay:nullable(number(0,24)),opDaysMonth:nullable(number(0,31)),demandFactor:nullable(number(0,1)),dutyType:s,tempSetting:nullable(number(-100,200)),opMode:s,estimatedKwhMonth:n,carbonEstimate:n,imageData:image,tankCapacityLiters:n,tankType:nullable(s),linkedPumpAssetId:nullable(integer(1)),safeOperatingLevelPct:nullable(number(0,100)),minLevelAlertPct:nullable(number(0,100)),ratedFlowGpm:n,ratedPressurePsi:n,pipelineLengthM:n,headDifferenceM:n,suctionSource:nullable(s),normalRuntimeMinPerDay:nullable(number(0,1440))}),
  inventory:schema(['description','category','unit','qty'],{description:nonempty(300),category:nonempty(120),unit:nonempty(80),qty:number(),minLevel:number(),originalQty:number()}),
  issuance:schema(['date','description','qtyIssued','issuedTo'],{date,description:nonempty(300),qtyIssued:number(0.0001),issuedTo:nonempty(300),invId:integer(1),invDocId:identifierValue,woDocId:nullable(identifierValue),lineId:identifierValue,woRef:s,category:s,unit:text(80),section:one(sections)}),
  waste:schema(['date','type','volume'],{date,type:one(['Infectious','Pathological','Chemical','Pharmaceutical','Sharps','Biodegradable','Recyclable','Residual','FOG','Radioactive']),volume:number(),contractor:s,emb:one(['OK','NON-COMPLIANT','Non-Compliant','Pending']),photo:image,createdAt:d}),
  safety:schema(['date','description','severity','status'],{date,description:nonempty(4000),severity:one(['Low','Moderate','High','Critical']),status:one(['Open','Under Action','Resolved','Verified','Closed']),location:s,asset:s,assetDocId:nullable(identifierValue),targetDate:d,loggedBy:s,responsible:s,dateClosed:d}),
  projects:schema(['code','title','status'],{title:nonempty(500),category:s,location:s,status:one(['Proposed','For Approval','Ongoing','Delayed','Completed','Closed']),budget:n,fundingSource:s,responsible:s,startDate:d,targetDate:d,actualDate:d,physicalPct:number(0,100),financialPct:number(0,100)}),
  waterLogs:schema(['date','ward','testType','result'],{date,ward:nonempty(300),testType:one(['Bacteriological','Chemical','Physical','Full Analysis','Residual Chlorine']),result:one(['Safe','Warning','Fail']),bacteriaCount:numText,chlorine:numText,residualChlorine:numText,mitigation:s,resultImage:image}),
  waterTank:schema(['dateTime','tankName','tankLevel'],{dateTime,datetime:dateTime,tankName:nonempty(300),linkedAssetId:nullable(integer(1)),tankCapacityL:n,minLevelAlertPct:nullable(number(0,100)),tankLevel:number(0,100),levelPct:number(0,100),patientCount:integer(),outpatients:integer(),erCases:integer(),watchers:integer(),visitors:integer(),activeStaff:integer(),operationalFactors:array(one(['Heavy Laundry','Heavy Kitchen','Heavy Cleaning','Gardening','Maintenance Flushing','Special Event']),10),assumptionProfileId:s,calcBasisSummary:s}),
  effluent:schema(['date','samplingPoint','status'],{date,samplingPoint:nonempty(300),status:one(['Compliant','Non-Compliant','Pending Analysis']),pH:nullable(number(0,14)),BOD:n,COD:n,TSS:n,oilGrease:n,temperature:nullable(number(-10,150)),totalColiform:n,fecalColiform:n,dissolvedOxygen:n}),
  medWasteProd:schema(['date','shift','status'],{date,shift:nonempty(80),status:one(['Normal','Downtime','Maintenance']),inputQty:n,treatedQty:n,outputQty:n,opHours:nullable(number(0,24)),downtime:nullable(number(0,24)),utilizationPct:nullable(number(0,100))}),
  wwProd:schema(['date','shift','status'],{date,shift:nonempty(80),status:one(['Normal','Downtime','Maintenance']),inflow:n,treated:n,outflow:n,opHours:nullable(number(0,24)),downtime:nullable(number(0,24)),utilizationPct:nullable(number(0,100))}),
  censusLog:schema(['date','count'],{date,count:integer(0,100000)}),
  waterSettings:schema([],{}),
  energyBills:schema(['period','actualKwh','billAmount'],{period:v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v),periodLabel:text(80),actualKwh:number(0.0001),billAmount:number(0.01),demandKw:n,accountNo:text(120),meterNo:text(120),theoreticalKwh:n})
};
const waterNumbers='pumpLph pumpRuntimeHrDay reservoirCapL threshSecure threshWatch threshLow threshCritical pumpSafe pumpNearLimit varWithin varAbove varHigh defInpatients defOutpatients defER defWatchers defVisitors totalStaff staffPresenceFactor refInpatient refOutpatient refER refWatcher refVisitor refStaff addLaundryHeavy addLaundryNormal addKitchenHeavy addKitchenNormal addCleaningHeavy addCleaningNormal addGardening addFlushing occupiedBeds totalFaucets totalToilets totalUrinals totalWashAreas totalWashingMachines totalKitchenSinks totalJanitorial totalHoseBibbs wwtpReturnFactor flushVolL faucetFlowLpm avgFaucetUseMin';
// Accept existing form values without silently renaming classifications or optional observations.
SCHEMAS.assets.fields.condition=one(['Good','Fair','Poor','For Replacement','For Repair','Unserviceable','Condemned']);
SCHEMAS.waste.fields.emb=one(['OK','Warning','Critical','NON-COMPLIANT','Non-Compliant','Pending']);
SCHEMAS.effluent.fields.customParams=array(v=>plain(v)&&Object.keys(v).every(k=>['name','value','unit'].includes(k))&&nonempty(200)(v.name)&&nullable(number())(v.value)&&text(80)(v.unit),50);
for(const k of ['outpatients','erCases','watchers','visitors','activeStaff'])SCHEMAS.waterTank.fields[k]=nullable(integer());
SCHEMAS.waterTank.fields.operationalFactors=array(one(['Heavy Laundry','Heavy Kitchen','Heavy Cleaning','Gardening','Outdoor Watering','Maintenance Flushing','Special Event']),10);
for(const k of waterNumbers.split(' '))SCHEMAS.waterSettings.fields[k]=number();
for(const k of ['staffPresenceFactor','wwtpReturnFactor'])SCHEMAS.waterSettings.fields[k]=number(0,1);
for(const k of ['threshSecure','threshWatch','threshLow','threshCritical','pumpSafe','pumpNearLimit','varWithin','varAbove','varHigh'])SCHEMAS.waterSettings.fields[k]=number(0,100);
SCHEMAS.waterSettings.fields.pumpRuntimeHrDay=number(0,24);
SCHEMAS.waterSettings.fields.activeReference=s;
for(const k of ['assetLinkedMode','showWWTPPanel','showAlarmPanel','showCalcBasis','showAssetLinked','showExpectedComp'])SCHEMAS.waterSettings.fields[k]=bool;
export function validateRecord(store,payload) {
  if(!STORES.includes(store))bad('Unknown store');
  const schema=SCHEMAS[store];exactKeys(payload,Object.keys(schema.fields));
  for(const k of schema.required)if(payload[k]===undefined||payload[k]===null||payload[k]==='')bad('Required: '+k);
  for(const [k,v]of Object.entries(payload))if(!schema.fields[k](v))bad('Invalid field: '+k);
  for(const [start,end]of [['dateStart','dateEnd'],['startDate','actualDate'],['date','dateClosed']])if(payload[start]&&payload[end]&&payload[end]<payload[start])bad('Completion precedes start');
  if(store==='wo'&&payload.workScope==='asset'&&!payload.assetDocId)bad('Equipment work requires assetDocId');
  if(store==='wo'&&payload.workScope==='room'&&(!payload.locationId||payload.assetDocId))bad('Room work requires locationId without assetDocId');
  if(store==='waterTank'&&payload.datetime&&payload.datetime!==payload.dateTime)bad('Datetime aliases disagree');
  if(store==='waterTank'&&payload.levelPct!==undefined&&payload.levelPct!==payload.tankLevel)bad('Level aliases disagree');
  if(Buffer.byteLength(JSON.stringify(payload))>750000)bad('Record exceeds supported payload size');
  return structuredClone(payload);
}
export function validateMembership(v) {
  exactKeys(v,['role','active','facilityId']);
  if(!one(['staff','admin'])(v.role)||!bool(v.active)||v.facilityId!=='dopmc')bad('Invalid membership');return v;
}
export function validateEnergySettings(v) {
  exactKeys(v,['gridRegion','emissionFactor','targetReductionPct','baselineYear','factorSource']);
  if(!nonempty(80)(v.gridRegion)||!number(0,100)(v.emissionFactor)||!number(0,100)(v.targetReductionPct)||!integer(1900,2200)(v.baselineYear)||!nonempty(1000)(v.factorSource))bad('Invalid energy settings');return v;
}
