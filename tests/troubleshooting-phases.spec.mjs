import {test,expect} from '@playwright/test';
import {bootstrapApp} from './helpers/bootstrap.mjs';
test.beforeEach(async({page})=>bootstrapApp(page));

test('phase 1: selected energy year renders without an exception and respects zero load',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('energyBills',[{id:1,period:'2026-01',actualKwh:100,theoreticalKwh:200,billAmount:1000}]);
  populateEnergyFilters();document.getElementById('en-year').value='2026';renderEnergy();
  const asset={name:'Lamp',ratedWatts:100,opHoursDay:10,opDaysMonth:30,demandFactor:0,qty:1};
  return {factor:calcAssetKwh(asset),hours:calcAssetKwh({...asset,demandFactor:1,opHoursDay:0}),qty:calcAssetKwh({...asset,demandFactor:1,qty:0}),text:document.getElementById('energy-tbody').textContent};
 });
 expect(result.factor).toBe(0);expect(result.hours).toBe(0);expect(result.qty).toBe(0);expect(result.text).toContain('100.0');
});

test('phase 2: asset codes survive gaps and staged imports without reuse',async({page})=>{
 const codes=await page.evaluate(()=>{
  const a={name:'Fluorescent Tube',location:'RAMP',section:'Electrical'};
  applyStoreData('assets',[{id:1,assetCode:'FL-ELEC-RAMP-01'},{id:3,assetCode:'FL-ELEC-RAMP-03'}]);
  const first=generateAssetCodeFull(a);const staged=[...DB.g('assets'),{id:4,assetCode:first}];
  return [first,generateAssetCodeFull(a,staged)];
 });
 expect(codes[0]).not.toBe('FL-ELEC-RAMP-03');expect(new Set(codes).size).toBe(2);
});

test('phase 2: history follows stable identity and only unambiguous legacy matches',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('assets',[{id:1,_docId:'lamp',name:'FLOURESCENT TUBE 18W',location:'RAMP',section:'Electrical'}]);
  applyStoreData('wo',[{id:2,asset:'Flourescent Tube 18 Watts',location:'RAMP',description:'Legacy repair',status:'Closed'},{id:3,asset:'Old name',assetDocId:'lamp',description:'Linked repair',status:'Closed'}]);
  viewHistory(1);const unique=document.getElementById('history-tbody').textContent;
  applyStoreData('assets',[...DB.g('assets'),{id:4,_docId:'other',name:'Fluorescent Tube 18 Watts',location:'RAMP',section:'Electrical'}]);
  viewHistory(1);return {unique,ambiguous:document.getElementById('history-tbody').textContent};
 });
 expect(result.unique).toContain('Legacy repair');expect(result.unique).toContain('Linked repair');
 expect(result.ambiguous).not.toContain('Legacy repair');expect(result.ambiguous).toContain('Linked repair');
});

test('phase 2: explicit RAMP ownership saves only the selected stable reference',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('assets',[{id:1,_docId:'ramp-01',assetCode:'OT-ELEC-RAMP-01',name:'Fluorescent Tube 18W',section:'Electrical',location:'RAMP'},{id:3,_docId:'ramp-03',assetCode:'OT-ELEC-RAMP-03',name:'Fluorescent Tube 18W',section:'Electrical',location:'RAMP'}]);
  applyStoreData('wo',[{id:11,_docId:'repair-11',code:'ELEC-HI-0011',asset:'Fluorescent Tube 18W',section:'Electrical',location:'RAMP',description:'Confirmed RAMP repair',priority:'High',status:'Closed',dateStart:'2026-01-01',dateEnd:'2026-01-02'}]);
  openWOModal(11);const select=document.getElementById('m-wo-asset');select.selectedIndex=[...select.options].findIndex(o=>o.dataset.docId==='ramp-01');saveWO();
  const saved=DB.g('wo').find(w=>w.id===11);viewHistory(1);const ownerHistory=document.getElementById('history-tbody').textContent;viewHistory(3);const otherHistory=document.getElementById('history-tbody').textContent;
  return {saved,ownerHistory,otherHistory};
 });
 expect(result.saved.assetDocId).toBe('ramp-01');expect(result.saved.code).toBe('ELEC-HI-0011');expect(result.ownerHistory).toContain('Confirmed RAMP repair');expect(result.otherHistory).not.toContain('Confirmed RAMP repair');
});

test('phase 3: safety and project summaries reconcile with table filters',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('safety',[{id:1,severity:'Critical',status:'Open',description:'Critical',date:'2026-01-01'},{id:2,severity:'Low',status:'Open',description:'Low',date:'2026-01-01'}]);
  document.getElementById('sf-sev').value='Low';renderSafety();
  const safety=document.getElementById('safety-summary-bars').textContent.replace(/\s+/g,'');
  applyStoreData('projects',[{id:1,title:'Old',status:'Ongoing',startDate:'2025-01-01'},{id:2,title:'New',status:'Ongoing',startDate:'2026-01-01'}]);
  navigate('projects');document.getElementById('pj-year').value='2026';renderProjects();
  return {safety,projects:document.getElementById('proj-stat-row').textContent.replace(/\s+/g,'')};
 });
 expect(result.safety).toContain('Critical0');expect(result.projects).toContain('TotalProjects1');
});

test('phase 3: forecasts distinguish no history and include zero-day completions',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('wo',[{id:1,code:'NO-HISTORY',section:'Unlisted',status:'Open',dateStart:'2026-01-01',description:'Location repair'},{id:2,section:'Electrical',status:'Closed',dateStart:'2026-01-01',dateEnd:'2026-01-01'},{id:3,code:'ZERO-DAY',section:'Electrical',status:'Open',dateStart:'2026-01-02'}]);
  renderForecast();return [...document.getElementById('fc-tbody').rows].map(r=>r.textContent);
 });
 expect(result[0]).toContain('Insufficient data');expect(result[0]).not.toContain('undefined');
 expect(result[1]).toContain('0 days');expect(result[1]).not.toContain('Insufficient data');
});

test('phase 4: safety dates, transitions, reopening and legacy unknown dates are honest',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('safety',[{id:1,date:'2026-01-01',description:'Legacy resolved',severity:'Critical',status:'Resolved'}]);
  openSafetyModal(1);document.getElementById('m-sf-remarks').value='Reviewed';saveSafety();
  const legacy=DB.g('safety')[0];
  openSafetyModal();document.getElementById('m-sf-desc').value='New hazard';document.getElementById('m-sf-sev').value='High';document.getElementById('m-sf-status').value='Resolved';saveSafety();
  const created=DB.g('safety').find(s=>s.description==='New hazard');const resolved=created.resolvedAt;
  openSafetyModal(created.id);document.getElementById('m-sf-status').value='Open';saveSafety();
  const reopened=DB.g('safety').find(s=>s.id===created.id);
  return {legacyDate:legacy.resolvedAt,legacyMetrics:getSafetyMetrics([legacy]),resolved,reopened};
 });
 expect(result.legacyDate).toBeNull();expect(result.legacyMetrics.averageResolution).toBeNull();expect(result.legacyMetrics.highCritical).toBe(0);
 expect(result.resolved).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(result.reopened.resolvedAt).toBeNull();expect(result.reopened.statusHistory.map(e=>e.to)).toEqual(['Resolved','Open']);
});

test('phase 4: safety overdue and closure metrics match the defined population',async({page})=>{
 const result=await page.evaluate(()=>getSafetyMetrics([
  {date:'2026-01-01',severity:'Critical',status:'Open',targetDate:'2026-01-05',location:'ER'},
  {date:'2026-01-01',severity:'High',status:'Under Action',location:'ER'},
  {date:'2026-01-01',severity:'Critical',status:'Verified',resolvedAt:'2026-01-04'},
  {date:'2026-01-01',severity:'Low',status:'Closed',resolvedAt:'2026-01-06'},
 ],'2026-01-10'));
 expect(result.highCritical).toBe(2);expect(result.overdue).toBe(1);expect(result.closureRate).toBe(50);expect(result.averageResolution).toBe(4);expect(result.highestRisk).toBe('ER');expect(result.missingTargets).toBe(1);
});

test('phase 5: project metrics use budgets and dated observations rather than invented history',async({page})=>{
 const result=await page.evaluate(()=>{
  const rows=[{id:1,budget:100,physicalPct:20,financialPct:30,status:'Delayed',targetDate:'2026-01-01',progressHistory:[{date:'2026-01-01',physicalPct:10,plannedPct:20},{date:'2026-01-11',physicalPct:20,plannedPct:30}]},{id:2,budget:300,physicalPct:60,financialPct:50,status:'Completed',targetDate:'2026-01-15',actualDate:'2026-01-10'}];
  return {metrics:getProjectMetrics(rows,'2026-01-20'),forecast:forecastProject(rows[0]),legacy:forecastProject(rows[1]),monthly:projectMonthlyObservations(rows)};
 });
 expect(result.metrics.physical).toBe(50);expect(result.metrics.financial).toBe(45);expect(result.metrics.onTime).toBe(100);expect(result.metrics.budgetAtRisk).toBe(100);expect(result.metrics.overdue).toBe(1);
 expect(result.forecast.date).toBe('2026-04-01');expect(result.monthly).toEqual([['2026-01',30,20,1]]);
});

test('phase 5: project edits retain progress and baseline history, and reject invalid percentages',async({page})=>{
 const result=await page.evaluate(()=>{
  openProjectModal();document.getElementById('m-pj-code').value='P-1';document.getElementById('m-pj-title').value='Repair';document.getElementById('m-pj-physical').value='20';saveProject();
  const id=DB.g('projects')[0].id;openProjectModal(id);document.getElementById('m-pj-physical').value='40';document.getElementById('m-pj-spend').value='100';saveProject();
  openProjectModal(id);document.getElementById('m-pj-physical').value='140';saveProject();
  return {row:DB.g('projects')[0],open:document.getElementById('mo-project').classList.contains('open')};
 });
 expect(result.row.physicalPct).toBe(40);expect(result.row.actualSpend).toBe(100);expect(result.row.progressHistory.map(o=>o.physicalPct)).toEqual([20,40]);expect(result.row.baselineHistory).toHaveLength(1);expect(result.open).toBe(true);
});

test('phase 6: carbon uses saved factors and comparable months, without asset double counting',async({page})=>{
 const result=await page.evaluate(()=>{
  const factor={id:'f',value:0.5,unit:'kgCO2e/kWh',status:'verified',grid:'Test',source:'Synthetic fixture',effectiveFrom:'2025-01-01',effectiveTo:'2026-12-31'};
  const rows=[{period:'2026-01',actualKwh:100,carbonFactor:factor},{period:'2026-02',actualKwh:200,carbonFactor:factor}],baseline=[{period:'2025-01',actualKwh:200},{period:'2025-02',actualKwh:400}];
  const settings={baselineMethod:'previous',targetPct:10,factors:[factor]};
  applyStoreData('assets',[{id:1,ratedWatts:100000,opHoursDay:24,opDaysMonth:30,demandFactor:1,qty:1}]);
  return {complete:getEnergyMetrics(rows,[...rows,...baseline],settings),missing:getEnergyMetrics(rows,[...rows,baseline[0]],settings),unverified:getEnergyMetrics([{...rows[0],carbonFactor:null}],baseline,settings),overlap:factorForPeriod('2026-01',{...settings,factors:[factor,{...factor,id:'f2'}]})};
 });
 expect(result.complete.actual).toBe(300);expect(result.complete.kg).toBe(150);expect(result.complete.tonnes).toBe(.15);expect(result.complete.intensity).toBe(.5);expect(result.complete.reduction).toBe(50);expect(result.complete.target).toBe(540);expect(result.complete.avoidedTonnes).toBe(.15);
 expect(result.missing.reduction).toBeNull();expect(result.unverified.kg).toBeNull();expect(result.overlap).toBeNull();
});

test('phase 6: factor changes preserve previously saved bill calculations',async({page})=>{
 const result=await page.evaluate(()=>{
  const factor={id:'old',value:.5,unit:'kgCO2e/kWh',grid:'Test',source:'Synthetic',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',status:'verified'};
  _fbMetaState.energySettings={revision:1,factors:[factor],baselineMethod:'previous',targetPct:10};
  openEnergyModal();document.getElementById('m-en-month').value='01';document.getElementById('m-en-year').value='2026';document.getElementById('m-en-actual').value='100';document.getElementById('m-en-amount').value='1000';saveEnergy();
  _fbMetaState.energySettings.factors=[{...factor,id:'new',value:.9}];
  const id=DB.g('energyBills')[0].id;openEnergyModal(id);document.getElementById('m-en-remarks').value='Reviewed';saveEnergy();
  return {factor:DB.g('energyBills')[0].carbonFactor,kg:getBillCarbon(DB.g('energyBills')[0])};
 });
 expect(result.factor.id).toBe('old');expect(result.kg).toBe(50);
});

test('phase 7: energy filters reconcile cards, annual totals and chart observations',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('energyBills',[{id:1,period:'2026-01',periodLabel:'Jan 2026',actualKwh:100,theoreticalKwh:200,billAmount:1000,remarks:'Keep'},{id:2,period:'2026-02',actualKwh:300,theoreticalKwh:400,billAmount:2000,remarks:'Exclude'}]);
  document.getElementById('en-search').value='Keep';renderEnergy();
  return {kpi:document.getElementById('en-stat-row').textContent,annual:document.getElementById('energy-annual-tbody').textContent,chart:document.getElementById('en-actual-chart').textContent};
 });
 expect(result.kpi).toContain('100');expect(result.annual).not.toContain('400');expect(result.chart).toContain('100');expect(result.chart).not.toContain('300');
});

test('phase 2: CSV imports reserve staged asset codes and retain document identity on update',async({page})=>{
 await page.evaluate(()=>{
  const file=new File(['Asset Name,Section,Location,Record Doc ID,Load Factor\nCompact Bulb 15W,Electrical,RAMP,lamp-a,0\nCompact Bulb 15W,Electrical,RAMP,lamp-b,1'],'assets.csv');
  importAssetCSV({target:{files:[file],value:''}});
 });
 await page.waitForFunction(()=>DB.g('assets').length===2);
 const before=await page.evaluate(()=>DB.g('assets'));
 expect(new Set(before.map(a=>a.assetCode)).size).toBe(2);expect(before.find(a=>a._docId==='lamp-a').demandFactor).toBe(0);expect(before[0].assetType).toBe('Light Bulb');
 await page.evaluate(()=>{const file=new File(['Asset Name,Section,Location,Record Doc ID\nRenamed bulb,Electrical,RAMP,lamp-a'],'update.csv');importAssetCSV({target:{files:[file],value:''}});});
 await page.waitForFunction(()=>DB.g('assets').some(a=>a.name==='Renamed bulb'));
 const after=await page.evaluate(()=>DB.g('assets'));
 expect(after).toHaveLength(2);expect(after.find(a=>a._docId==='lamp-a').id).toBe(before.find(a=>a._docId==='lamp-a').id);
});

test('phase 6: retirement and reviewed backfill preserve existing factor snapshots',async({page})=>{
 const result=await page.evaluate(async()=>{
  _FB.isAdmin=true;
  const factor={id:'old',value:.5,unit:'kgCO2e/kWh',grid:'Test',source:'Synthetic fixture',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',status:'verified'};
  _fbMetaState.energySettings={revision:1,factors:[factor],baselineMethod:'previous',targetPct:10,audit:[]};
  applyStoreData('energyBills',[{id:1,period:'2026-01',actualKwh:100,theoreticalKwh:100,billAmount:500,carbonFactor:factor},{id:2,period:'2026-02',actualKwh:200,theoreticalKwh:200,billAmount:1000}]);
  await applyMissingBillFactors();const assigned=DB.g('energyBills').find(b=>b.id===2).carbonFactor;
  _fbPendingStoreOps=Object.create(null);_fbPendingMetaMerge={};
  await retireEnergyFactor('old');
  return {assigned,existing:getBillCarbon(DB.g('energyBills')[0]),future:factorForPeriod('2026-03'),status:getEnergySettings().factors[0].status};
 });
 expect(result.assigned.id).toBe('old');expect(result.existing).toBe(50);expect(result.future).toBeNull();expect(result.status).toBe('retired');
});

test('phase 4: historical outstanding needs complete transitions and reflects reopening',async({page})=>{
 const result=await page.evaluate(()=>{
  const r={date:'2026-01-01',status:'Open',statusHistory:[{from:null,to:'Open',date:'2026-01-01',at:1},{from:'Open',to:'Resolved',date:'2026-02-01',at:2},{from:'Resolved',to:'Open',date:'2026-03-01',at:3}]};
  return [safetyOutstandingAsOf([r],'2026-01-31'),safetyOutstandingAsOf([r],'2026-02-28'),safetyOutstandingAsOf([r],'2026-03-31'),safetyOutstandingAsOf([{date:'2026-01-01',status:'Closed'}],'2026-02-28')];
 });expect(result).toEqual([1,0,1,null]);
});

test('phase 7: dashboard pages and forms render without errors at desktop and mobile sizes',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  for(const name of ['safety','projects','energy']){
   await page.evaluate(name=>navigate(name),name);
   await expect(page.locator('#page-'+name)).toHaveClass(/active/);
   const widthCheck=await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth}));expect(widthCheck.body).toBeLessThanOrEqual(widthCheck.viewport+1);
   if(width===390){
    const controls=await page.locator('#page-'+name+' > .mb14:first-child').locator('select,input[type="text"],button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width})));
    for(const control of controls){expect(control.left).toBeGreaterThanOrEqual(0);expect(control.right).toBeLessThanOrEqual(width);expect(control.width).toBeGreaterThan(70);}
   }
  }
  await page.evaluate(()=>openSafetyModal());await expect(page.locator('#m-sf-target')).toBeVisible();await page.evaluate(()=>closeModal('mo-safety'));
  await page.evaluate(()=>{_FB.isAdmin=true;openEnergySettings();});await expect(page.locator('#es-source')).toBeVisible();await page.evaluate(()=>closeModal('mo-energy-settings'));
 }
 expect(errors).toEqual([]);
});
