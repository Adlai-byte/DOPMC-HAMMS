/**
 * HAMMS Data Seeding Script
 * Uses Playwright to navigate to the deployed app, log in, and inject 100+ records
 * across all 12 modules via the app's own save functions.
 */
import { chromium } from 'playwright';

const APP_URL = 'https://demoapp-7864a.web.app';
const EMAIL = 'vinzlloydalferez@gmail.com';
const PASSWORD = 'alferez123';

const results = {};

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Increase default timeout
  page.setDefaultTimeout(60000);

  // ── Phase 0: Login ──
  console.log('Phase 0: Navigating to app...');
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('Logging in...');
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('#login-btn');

  // Wait for login to complete - look for the app content to appear
  console.log('Waiting for login...');
  await page.waitForFunction(() => {
    const loginCard = document.getElementById('login-card');
    return loginCard && (loginCard.style.display === 'none' || !loginCard.offsetParent);
  }, { timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log('Logged in successfully!');

  // Setup overrides
  await page.evaluate(() => {
    window.confirm = () => true;
    window._alerts = [];
    window.alert = m => window._alerts.push(m);
  });

  // Check available functions
  const fnCheck = await page.evaluate(() => {
    const fns = ['openWOModal','saveWO','renderWO','openAssetModal','saveAsset','renderAssets',
      'openInvModal','saveInvItem','renderInventory','openIssueModal','saveManualIssue','renderIssuance',
      'openWasteModal','saveWaste','renderWaste','openSafetyModal','saveSafety','renderSafety',
      'openProjectModal','saveProject','renderProjects','openWaterLogModal','saveWaterLog','renderWaterLogs',
      'openTankModal','saveTankReading','renderWaterTank','openEffluentModal','saveEffluent','renderEffluent',
      'openMedWasteModal','saveMedWaste','renderMedWaste',
      'openWWProdModal','saveWWProd','renderWWProd','DB','navigate'];
    const r = {};
    fns.forEach(f => r[f] = typeof window[f]);
    return r;
  });
  console.log('Function check:', JSON.stringify(fnCheck, null, 2));

  // DB is declared with const, not on window. Check via a function that uses it.
  await page.waitForFunction(() => {
    try { return typeof saveWO === 'function'; } catch(e) { return false; }
  }, { timeout: 15000 });
  // Expose DB on window for our scripts
  await page.evaluate(() => {
    // DB is a const in the same scope as other globals
    // We can access it through the functions that use it
    // Let's create a window accessor
    window._DB = { g: k => DB.g(k), s: (k,v) => DB.s(k,v), nid: k => DB.nid(k) };
  });
  console.log('DB accessor ready.');

  // ── Module 1: Work Orders (15 records) ──
  console.log('\n=== Module 1: Work Orders ===');
  results.wo = await page.evaluate(() => {
    const wos = [
      {section:'Electrical',desc:'Replace faulty circuit breaker — Ward 2 panel B',priority:'High',status:'Open',dstart:'2026-01-05',dend:'2026-01-10',assigned:'Juan dela Cruz',remarks:'Breaker keeps tripping under load'},
      {section:'Plumbing',desc:'Fix leaking pipe in ICU bathroom ceiling',priority:'High',status:'Open',dstart:'2026-01-08',dend:'2026-01-09',assigned:'Pedro Santos',remarks:'Water dripping on equipment'},
      {section:'Mechanical',desc:'AC unit not cooling — Operating Room 1',priority:'High',status:'In Progress',dstart:'2026-01-10',dend:'2026-01-12',assigned:'Ramon Reyes',remarks:'Compressor noise detected'},
      {section:'Electrical',desc:'Install new LED lighting in corridor B',priority:'Low',status:'Closed',dstart:'2026-01-12',dend:'2026-01-15',assigned:'Juan dela Cruz',remarks:'Old fluorescent tubes replaced'},
      {section:'CMW',desc:'Replace worn mattress covers — Room 301',priority:'Medium',status:'Open',dstart:'2026-01-15',dend:'2026-01-20',assigned:'Maria Garcia',remarks:'Hygiene concern flagged by nursing'},
      {section:'Plumbing',desc:'Unclog drain in staff restroom 2F',priority:'Medium',status:'Closed',dstart:'2026-01-18',dend:'2026-01-18',assigned:'Pedro Santos',remarks:'Root intrusion removed'},
      {section:'CMW',desc:'Repair ceiling crack in Admin Office',priority:'Medium',status:'In Progress',dstart:'2026-01-20',dend:'2026-01-28',assigned:'Jose Ramos',remarks:'Structural assessment pending'},
      {section:'Electrical',desc:'Replace emergency exit sign lights — all floors',priority:'High',status:'Open',dstart:'2026-02-01',dend:'2026-02-05',assigned:'Juan dela Cruz',remarks:'Fire safety compliance'},
      {section:'Mechanical',desc:'Preventive maintenance — all AHUs quarterly',priority:'Medium',status:'Open',dstart:'2026-02-05',dend:'2026-02-10',assigned:'Ramon Reyes',remarks:'Q1 2026 scheduled PM'},
      {section:'Plumbing',desc:'Water pressure low in laboratory wing faucets',priority:'High',status:'Open',dstart:'2026-02-08',dend:'2026-02-09',assigned:'Pedro Santos',remarks:'Affecting lab operations'},
      {section:'CMW',desc:'Repair broken door handle — Room 205',priority:'Low',status:'Closed',dstart:'2026-02-10',dend:'2026-02-11',assigned:'Maria Garcia',remarks:'Handle replaced'},
      {section:'Electrical',desc:'Inspect and load-test generator set',priority:'High',status:'In Progress',dstart:'2026-02-15',dend:'2026-02-18',assigned:'Juan dela Cruz',remarks:'Annual generator certification'},
      {section:'CMW',desc:'Paint peeling in Pediatric Ward walls',priority:'Low',status:'Open',dstart:'2026-02-20',dend:'2026-02-28',assigned:'Jose Ramos',remarks:'Moisture damage identified'},
      {section:'Plumbing',desc:'Install new handwashing station near ER triage',priority:'Medium',status:'Open',dstart:'2026-03-01',dend:'2026-03-07',assigned:'Pedro Santos',remarks:'DOH compliance requirement'},
      {section:'Mechanical',desc:'Clean and service exhaust fans — kitchen area',priority:'Medium',status:'Open',dstart:'2026-03-05',dend:'2026-03-08',assigned:'Ramon Reyes',remarks:'Grease buildup noted'},
    ];
    let count = 0;
    for (const w of wos) {
      try {
        openWOModal();
        const s = id => document.getElementById(id);
        s('m-wo-section').value = w.section;
        s('m-wo-desc').value = w.desc;
        s('m-wo-priority').value = w.priority;
        s('m-wo-status').value = w.status;
        s('m-wo-dstart').value = w.dstart;
        s('m-wo-dend').value = w.dend;
        s('m-wo-assigned').value = w.assigned;
        s('m-wo-remarks').value = w.remarks;
        saveWO();
        count++;
      } catch(e) { console.warn('WO error:', e.message); }
    }
    navigate('workorders');
    if (typeof renderWO === 'function') renderWO();
    return { target: 15, inserted: count, dbTotal: window._DB.g('wo').length };
  });
  console.log('Work Orders:', JSON.stringify(results.wo));

  // ── Module 2: Assets (15 records) ──
  console.log('\n=== Module 2: Assets ===');
  results.assets = await page.evaluate(() => {
    const assets = [
      {name:'Window AC Unit — Ward 1',section:'Mechanical',brand:'Carrier',condition:'Good',loc:'Ward 1',remarks:''},
      {name:'Split AC Unit — Admin Office',section:'Mechanical',brand:'Samsung',condition:'Good',loc:'Admin Office',remarks:''},
      {name:'Emergency Generator 100kVA',section:'Electrical',brand:'Caterpillar',condition:'Good',loc:'Generator Room',remarks:''},
      {name:'Biomedical Waste Incinerator',section:'CMW',brand:'Addfield',condition:'Fair',loc:'Incinerator Area',remarks:''},
      {name:'Centrifugal Water Pump — Main',section:'Plumbing',brand:'Grundfos',condition:'Good',loc:'Pump Room',remarks:''},
      {name:'Rooftop Water Tank 20kL',section:'Plumbing',brand:'Sintex',condition:'Good',loc:'Roof Deck',remarks:''},
      {name:'Autoclave Sterilizer — CSSD',section:'CMW',brand:'Tuttnauer',condition:'Good',loc:'CSSD',remarks:''},
      {name:'Portable Suction Machine — ICU',section:'CMW',brand:'Medela',condition:'Fair',loc:'ICU',remarks:''},
      {name:'Oxygen Concentrator 10L — ICU',section:'CMW',brand:'Invacare',condition:'Good',loc:'ICU',remarks:''},
      {name:'Passenger Elevator — Main',section:'CMW',brand:'Otis',condition:'Good',loc:'Central Lobby',remarks:''},
      {name:'Fire Alarm Control Panel',section:'Electrical',brand:'Honeywell',condition:'Good',loc:'Security Office',remarks:''},
      {name:'CCTV NVR System 16-Channel',section:'Electrical',brand:'Hikvision',condition:'Good',loc:'Security Room',remarks:''},
      {name:'X-Ray Machine — Radiology',section:'CMW',brand:'Shimadzu',condition:'Good',loc:'Radiology',remarks:''},
      {name:'Ultrasound Machine — OB',section:'CMW',brand:'GE Healthcare',condition:'Good',loc:'OB-Gyne Clinic',remarks:''},
      {name:'Wastewater Treatment Plant',section:'Plumbing',brand:'ProMinent',condition:'Good',loc:'WTP Area',remarks:''},
    ];
    let count = 0;
    for (const a of assets) {
      try {
        openAssetModal();
        const s = id => document.getElementById(id);
        s('m-a-section').value = a.section;
        s('m-a-name').value = a.name;
        s('m-a-brand').value = a.brand;
        s('m-a-condition').value = a.condition;
        // Location field - m-a-loc is hidden and set by room picker logic
        // We'll set the remarks field instead with location info
        s('m-a-remarks').value = 'Location: ' + a.loc;
        saveAsset();
        count++;
      } catch(e) { console.warn('Asset error:', e.message); }
    }
    navigate('assets');
    if (typeof renderAssets === 'function') renderAssets();
    return { target: 15, inserted: count, dbTotal: window._DB.g('assets').length };
  });
  console.log('Assets:', JSON.stringify(results.assets));

  // ── Module 3: Inventory (12 records) ──
  console.log('\n=== Module 3: Inventory ===');
  results.inventory = await page.evaluate(() => {
    const items = [
      {desc:'Fluorescent Tube 40W T8',cat:'Electrical',unit:'pcs',qty:200,min:50},
      {desc:'PVC Pipe 1/2 inch x 10ft',cat:'Plumbing',unit:'pcs',qty:100,min:20},
      {desc:'Circuit Breaker 20A Bolt-on',cat:'Electrical',unit:'pcs',qty:30,min:10},
      {desc:'Latex Paint White 4L',cat:'CMW',unit:'gal',qty:15,min:5},
      {desc:'HEPA Filter 16x20x2',cat:'Mechanical',unit:'pcs',qty:12,min:4},
      {desc:'THHN Wire 2.0mm Red',cat:'Electrical',unit:'roll',qty:8,min:3},
      {desc:'Gate Valve 1 inch Brass',cat:'Plumbing',unit:'pcs',qty:20,min:5},
      {desc:'Lysol Disinfectant 1L',cat:'CMW',unit:'btl',qty:50,min:15},
      {desc:'Marine Plywood 3/4 x 4x8',cat:'CMW',unit:'sht',qty:10,min:3},
      {desc:'Welding Rod E6013 3.2mm',cat:'CMW',unit:'kg',qty:5,min:2},
      {desc:'Motor Oil 15W40 Diesel 1L',cat:'Mechanical',unit:'ltr',qty:20,min:5},
      {desc:'LED Bulb 15W Daylight',cat:'Electrical',unit:'pcs',qty:6,min:10},
    ];
    let count = 0;
    for (const i of items) {
      try {
        openInvModal();
        const s = id => document.getElementById(id);
        s('m-i-desc').value = i.desc;
        s('m-i-cat').value = i.cat;
        s('m-i-unit').value = i.unit;
        s('m-i-qty').value = i.qty;
        s('m-i-min').value = i.min;
        saveInvItem();
        count++;
      } catch(e) { console.warn('Inv error:', e.message); }
    }
    navigate('inventory');
    if (typeof renderInventory === 'function') renderInventory();
    return { target: 12, inserted: count, dbTotal: window._DB.g('inventory').length };
  });
  console.log('Inventory:', JSON.stringify(results.inventory));

  // ── Module 4: Issuance (8 records) ──
  console.log('\n=== Module 4: Issuance ===');
  results.issuance = await page.evaluate(() => {
    const inv = window._DB.g('inventory');
    if (!inv.length) return { target: 8, inserted: 0, dbTotal: 0, error: 'No inventory items' };
    const issues = [
      {search:'Fluorescent',qty:10,to:'Electrical Team',remarks:'Ward 3 corridor lamp replacement',date:'2026-01-10'},
      {search:'PVC',qty:5,to:'Plumbing Team',remarks:'ICU bathroom pipe repair',date:'2026-01-12'},
      {search:'Circuit',qty:2,to:'Juan dela Cruz',remarks:'Ward 2 panel B replacement',date:'2026-01-15'},
      {search:'Lysol',qty:5,to:'Housekeeping Dept',remarks:'Weekly cleaning supply release',date:'2026-01-20'},
      {search:'HEPA',qty:4,to:'Ramon Reyes',remarks:'AHU quarterly filter replacement',date:'2026-02-05'},
      {search:'Latex Paint',qty:3,to:'Jose Ramos',remarks:'Pediatric ward wall repainting',date:'2026-02-20'},
      {search:'Fluorescent',qty:15,to:'Electrical Team',remarks:'Monthly PM batch issuance',date:'2026-03-01'},
      {search:'Motor Oil',qty:4,to:'Ramon Reyes',remarks:'Generator quarterly maintenance',date:'2026-03-05'},
    ];
    let count = 0;
    for (const iss of issues) {
      try {
        const item = inv.find(i => (i.desc || i.description || '').includes(iss.search));
        if (!item) continue;
        openIssueModal();
        const s = id => document.getElementById(id);
        // Populate the dropdown
        const sel = s('m-iss-item');
        if (sel) sel.value = item.id;
        s('m-iss-qty').value = iss.qty;
        s('m-iss-to').value = iss.to;
        s('m-iss-date').value = iss.date;
        const rem = s('m-iss-remarks');
        if (rem) rem.value = iss.remarks;
        saveManualIssue();
        count++;
      } catch(e) { console.warn('Issuance error:', e.message); }
    }
    navigate('issuance');
    if (typeof renderIssuance === 'function') renderIssuance();
    return { target: 8, inserted: count, dbTotal: window._DB.g('issuance').length };
  });
  console.log('Issuance:', JSON.stringify(results.issuance));

  // ── Module 5: Waste (10 records) ──
  console.log('\n=== Module 5: Waste ===');
  // Note: EMB field options are OK/Warning/Critical, not Compliant/Non-Compliant
  results.waste = await page.evaluate(() => {
    const wastes = [
      {date:'2026-01-05',type:'Infectious',vol:12.5,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:'Weekly infectious waste hauling'},
      {date:'2026-01-12',type:'Infectious',vol:14.2,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:''},
      {date:'2026-01-19',type:'Infectious',vol:11.8,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:'Holiday week — lower volume'},
      {date:'2026-01-26',type:'Pathological',vol:3.5,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:'Placental waste included'},
      {date:'2026-02-02',type:'Infectious',vol:13.0,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:''},
      {date:'2026-02-09',type:'Sharps',vol:2.5,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:'Sharps container rotation'},
      {date:'2026-02-16',type:'Infectious',vol:15.5,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:'Dengue admissions spike'},
      {date:'2026-02-23',type:'Chemical',vol:1.2,contractor:'ChemWaste Solutions',emb:'Warning',remarks:'Expired lab reagents — manifest discrepancy noted'},
      {date:'2026-03-02',type:'Infectious',vol:13.8,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:''},
      {date:'2026-03-09',type:'Pathological',vol:4.0,contractor:'BioMed Disposal Inc.',emb:'OK',remarks:'OR specimens disposal'},
    ];
    let count = 0;
    for (const w of wastes) {
      try {
        openWasteModal();
        const s = id => document.getElementById(id);
        s('m-w-date').value = w.date;
        s('m-w-type').value = w.type;
        s('m-w-vol').value = w.vol;
        s('m-w-contractor').value = w.contractor;
        s('m-w-emb').value = w.emb;
        s('m-w-remarks').value = w.remarks;
        saveWaste();
        count++;
      } catch(e) { console.warn('Waste error:', e.message); }
    }
    navigate('waste');
    return { target: 10, inserted: count, dbTotal: window._DB.g('waste').length };
  });
  console.log('Waste:', JSON.stringify(results.waste));

  // ── Module 6: Safety (8 records) ──
  console.log('\n=== Module 6: Safety ===');
  // Safety severity options: Low, Moderate, High, Critical
  // Safety status options: Open, Under Action, Resolved, Verified, Closed
  results.safety = await page.evaluate(() => {
    const incidents = [
      {date:'2026-01-08',desc:'Wet floor slip incident — staff near nurses station',loc:'Ward 2 Nurses Station',sev:'Low',status:'Resolved',remarks:'Warning cones deployed, floor mopped'},
      {date:'2026-01-15',desc:'Needle stick injury — ICU nurse during IV insertion',loc:'ICU Bay 3',sev:'Moderate',status:'Resolved',remarks:'PEP administered per protocol'},
      {date:'2026-01-22',desc:'Electrical outlet sparking when plugging in monitor',loc:'GF Storage Room',sev:'High',status:'Resolved',remarks:'Outlet replaced, wiring inspected'},
      {date:'2026-02-03',desc:'Fire extinguisher missing from OR hallway bracket',loc:'2F OR Hallway',sev:'Low',status:'Resolved',remarks:'Replaced immediately from reserve stock'},
      {date:'2026-02-10',desc:'Loose stair handrail — back staircase 1F-2F',loc:'Back Staircase',sev:'Moderate',status:'Under Action',remarks:'Welding repair scheduled'},
      {date:'2026-02-18',desc:'Chemical spill — X-ray fixer solution in darkroom',loc:'Radiology Dark Room',sev:'High',status:'Resolved',remarks:'MSDS procedure followed, area decontaminated'},
      {date:'2026-03-01',desc:'Broken glass panel at ER entrance automatic door',loc:'ER Main Entrance',sev:'High',status:'Under Action',remarks:'Temporary board-up done, glass ordered'},
      {date:'2026-03-10',desc:'Smoke detector false alarm — Ward 3 ceiling unit',loc:'Ward 3',sev:'High',status:'Open',remarks:'Dust accumulation suspected, cleaning scheduled'},
    ];
    let count = 0;
    for (const inc of incidents) {
      try {
        openSafetyModal();
        const s = id => document.getElementById(id);
        s('m-sf-date').value = inc.date;
        s('m-sf-desc').value = inc.desc;
        s('m-sf-loc').value = inc.loc;
        s('m-sf-sev').value = inc.sev;
        s('m-sf-status').value = inc.status;
        s('m-sf-remarks').value = inc.remarks;
        saveSafety();
        count++;
      } catch(e) { console.warn('Safety error:', e.message); }
    }
    navigate('safety');
    return { target: 8, inserted: count, dbTotal: window._DB.g('safety').length };
  });
  console.log('Safety:', JSON.stringify(results.safety));

  // ── Module 7: Projects (5 records) ──
  console.log('\n=== Module 7: Projects ===');
  // Project status options: Proposed, For Approval, Ongoing, Delayed, Completed, Closed
  results.projects = await page.evaluate(() => {
    const projects = [
      {code:'PROJ-2026-001',title:'Rehabilitation of Ward 2 Electrical System',loc:'Ward 2 — Main Building',resp:'Engr. Juan dela Cruz',budget:450000,start:'2026-01-15',target:'2026-03-31',status:'Ongoing',physical:35,remarks:'Phase 1 panel replacement done'},
      {code:'PROJ-2026-002',title:'Construction of Additional Comfort Rooms',loc:'Ward 3 — Main Building',resp:'Engr. Jose Ramos',budget:280000,start:'2026-02-01',target:'2026-04-30',status:'Ongoing',physical:20,remarks:'Foundation work started'},
      {code:'PROJ-2026-003',title:'CCTV System Expansion — 8 cameras',loc:'All Buildings',resp:'Engr. Juan dela Cruz',budget:180000,start:'2026-01-05',target:'2026-02-28',status:'Completed',physical:100,remarks:'All cameras installed and live'},
      {code:'PROJ-2026-004',title:'Main Building Roof Waterproofing',loc:'Main Building Roof Deck',resp:'Engr. Jose Ramos',budget:320000,start:'2026-03-01',target:'2026-05-31',status:'Proposed',physical:0,remarks:'Awaiting BAC procurement'},
      {code:'PROJ-2026-005',title:'Water Pressure Booster System Upgrade',loc:'Pump Room — Main Building',resp:'Engr. Pedro Santos',budget:550000,start:'2026-02-15',target:'2026-06-30',status:'Ongoing',physical:15,remarks:'Design specs finalized, pump ordered'},
    ];
    let count = 0;
    for (const p of projects) {
      try {
        openProjectModal();
        const s = id => document.getElementById(id);
        s('m-pj-code').value = p.code;
        s('m-pj-title').value = p.title;
        s('m-pj-loc').value = p.loc;
        s('m-pj-resp').value = p.resp;
        s('m-pj-budget').value = p.budget;
        s('m-pj-start').value = p.start;
        s('m-pj-target').value = p.target;
        s('m-pj-status').value = p.status;
        s('m-pj-physical').value = p.physical;
        s('m-pj-remarks').value = p.remarks;
        saveProject();
        count++;
      } catch(e) { console.warn('Project error:', e.message); }
    }
    navigate('projects');
    if (typeof renderProjects === 'function') renderProjects();
    return { target: 5, inserted: count, dbTotal: window._DB.g('projects').length };
  });
  console.log('Projects:', JSON.stringify(results.projects));

  // ── Module 8: Water Logs (12 records) ──
  console.log('\n=== Module 8: Water Logs ===');
  // Water log result options: Safe, Warning, Fail
  // No coliform/ecoli/turbidity/pH fields - use bacteria and chlorine
  results.waterLogs = await page.evaluate(() => {
    const logs = [
      {date:'2026-01-05',ward:'ICU',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.3',remarks:'Monthly routine test'},
      {date:'2026-01-05',ward:'Pediatric Ward',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.3',remarks:''},
      {date:'2026-01-05',ward:'OR Complex',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.4',remarks:''},
      {date:'2026-01-12',ward:'Ward 2',type:'Bacteriological',result:'Fail',bacteria:'3',chlorine:'0.1',remarks:'Re-disinfection done',mitigation:'Hyperchlorination applied'},
      {date:'2026-01-14',ward:'Ward 2',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.35',remarks:'Post-hyperchlorination re-test — PASS'},
      {date:'2026-02-03',ward:'ICU',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.3',remarks:''},
      {date:'2026-02-03',ward:'ER',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.3',remarks:''},
      {date:'2026-02-03',ward:'Pediatric Ward',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.3',remarks:''},
      {date:'2026-03-03',ward:'ICU',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.3',remarks:''},
      {date:'2026-03-03',ward:'OR Complex',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.4',remarks:''},
      {date:'2026-03-03',ward:'Ward 2',type:'Bacteriological',result:'Safe',bacteria:'0',chlorine:'0.3',remarks:''},
      {date:'2026-03-10',ward:'Kitchen',type:'Chemical',result:'Safe',bacteria:'0',chlorine:'0.25',remarks:'Monthly kitchen tap test'},
    ];
    let count = 0;
    for (const l of logs) {
      try {
        openWaterLogModal();
        const s = id => document.getElementById(id);
        s('m-wl-date').value = l.date;
        s('m-wl-ward').value = l.ward;
        s('m-wl-type').value = l.type;
        s('m-wl-result').value = l.result;
        s('m-wl-bacteria').value = l.bacteria;
        s('m-wl-chlorine').value = l.chlorine;
        if (l.mitigation) s('m-wl-mitigation').value = l.mitigation;
        s('m-wl-remarks').value = l.remarks;
        saveWaterLog();
        count++;
      } catch(e) { console.warn('WaterLog error:', e.message); }
    }
    navigate('water');
    return { target: 12, inserted: count, dbTotal: window._DB.g('waterLogs').length };
  });
  console.log('Water Logs:', JSON.stringify(results.waterLogs));

  // ── Module 9: Water Tank (8 records) ──
  console.log('\n=== Module 9: Water Tank ===');
  results.waterTank = await page.evaluate(() => {
    const readings = [
      {dt:'2026-01-06T08:00',name:'Main Rooftop Tank',level:85,cap:20000,patients:180,remarks:'Normal operations'},
      {dt:'2026-01-13T08:00',name:'Main Rooftop Tank',level:78,cap:20000,patients:192,remarks:''},
      {dt:'2026-01-20T08:00',name:'Main Rooftop Tank',level:65,cap:20000,patients:205,remarks:''},
      {dt:'2026-01-27T08:00',name:'Main Rooftop Tank',level:30,cap:20000,patients:198,remarks:'Pump runtime increased to 18hrs'},
      {dt:'2026-02-03T08:00',name:'Main Rooftop Tank',level:88,cap:20000,patients:185,remarks:'Normal operations'},
      {dt:'2026-02-10T08:00',name:'Main Rooftop Tank',level:80,cap:20000,patients:178,remarks:''},
      {dt:'2026-03-03T08:00',name:'Main Rooftop Tank',level:75,cap:20000,patients:195,remarks:''},
      {dt:'2026-03-10T08:00',name:'Main Rooftop Tank',level:72,cap:20000,patients:210,remarks:''},
    ];
    let count = 0;
    for (const r of readings) {
      try {
        openTankModal();
        const s = id => document.getElementById(id);
        s('m-tk-dt').value = r.dt;
        s('m-tk-name').value = r.name;
        s('m-tk-level').value = r.level;
        s('m-tk-cap').value = r.cap;
        s('m-tk-patients').value = r.patients;
        s('m-tk-remarks').value = r.remarks;
        // Hidden status field
        s('m-tk-status').value = r.level < 40 ? 'Low' : 'Normal';
        saveTankReading();
        count++;
      } catch(e) { console.warn('Tank error:', e.message); }
    }
    navigate('watertank');
    return { target: 8, inserted: count, dbTotal: window._DB.g('waterTank').length };
  });
  console.log('Water Tank:', JSON.stringify(results.waterTank));

  // ── Module 10: Effluent (6 records) ──
  console.log('\n=== Module 10: Effluent ===');
  results.effluent = await page.evaluate(() => {
    const effluents = [
      {date:'2026-01-15',point:'STP Effluent',ph:7.1,bod:28,cod:55,tss:18,coliform:10,status:'Compliant',remarks:'Within DAO 2016-08 limits'},
      {date:'2026-01-31',point:'STP Effluent',ph:7.3,bod:32,cod:62,tss:22,coliform:15,status:'Compliant',remarks:''},
      {date:'2026-02-14',point:'STP Effluent',ph:6.8,bod:48,cod:95,tss:38,coliform:45,status:'Non-Compliant',remarks:'BOD exceeded — aeration increased'},
      {date:'2026-02-28',point:'STP Effluent',ph:7.2,bod:30,cod:58,tss:20,coliform:12,status:'Compliant',remarks:'Post-corrective action re-test'},
      {date:'2026-03-15',point:'STP Effluent',ph:7.0,bod:27,cod:52,tss:17,coliform:8,status:'Compliant',remarks:''},
      {date:'2026-03-15',point:'Drainage Outfall',ph:7.1,bod:35,cod:70,tss:25,coliform:20,status:'Compliant',remarks:'Point source monitoring'},
    ];
    let count = 0;
    for (const e of effluents) {
      try {
        openEffluentModal();
        const s = id => document.getElementById(id);
        s('m-eff-date').value = e.date;
        s('m-eff-point').value = e.point;
        s('m-eff-ph').value = e.ph;
        s('m-eff-bod').value = e.bod;
        s('m-eff-cod').value = e.cod;
        s('m-eff-tss').value = e.tss;
        s('m-eff-coliform').value = e.coliform;
        s('m-eff-status').value = e.status;
        s('m-eff-remarks').value = e.remarks;
        saveEffluent();
        count++;
      } catch(e2) { console.warn('Effluent error:', e2.message); }
    }
    navigate('effluent');
    return { target: 6, inserted: count, dbTotal: window._DB.g('effluent').length };
  });
  console.log('Effluent:', JSON.stringify(results.effluent));

  // ── Module 11: Med Waste Production (6 records) ──
  console.log('\n=== Module 11: Med Waste ===');
  // Fields: m-mw-date, m-mw-shift (AM Shift/PM Shift/Night Shift), m-mw-status, m-mw-input, m-mw-treated, m-mw-output, m-mw-ophrs, m-mw-downtime, m-mw-remarks
  results.medWasteProd = await page.evaluate(() => {
    const meds = [
      {date:'2026-01-31',shift:'AM Shift',input:52.5,treated:52.5,output:8.5,ophrs:6,remarks:'Full capacity operation'},
      {date:'2026-02-07',shift:'AM Shift',input:48.2,treated:48.2,output:7.8,ophrs:5,remarks:''},
      {date:'2026-02-14',shift:'AM Shift',input:55.0,treated:50.0,output:8.0,ophrs:6,remarks:'5kg held — incinerator maintenance'},
      {date:'2026-02-21',shift:'AM Shift',input:44.8,treated:44.8,output:7.2,ophrs:5,remarks:''},
      {date:'2026-02-28',shift:'AM Shift',input:51.2,treated:51.2,output:8.2,ophrs:6,remarks:'End of month batch'},
      {date:'2026-03-07',shift:'AM Shift',input:49.5,treated:49.5,output:8.0,ophrs:5,remarks:''},
    ];
    let count = 0;
    for (const m of meds) {
      try {
        openMedWasteModal();
        const s = id => document.getElementById(id);
        s('m-mw-date').value = m.date;
        s('m-mw-shift').value = m.shift;
        s('m-mw-input').value = m.input;
        s('m-mw-treated').value = m.treated;
        s('m-mw-output').value = m.output;
        s('m-mw-ophrs').value = m.ophrs;
        s('m-mw-remarks').value = m.remarks;
        saveMedWaste();
        count++;
      } catch(e) { console.warn('MedWaste error:', e.message); }
    }
    navigate('medwaste');
    return { target: 6, inserted: count, dbTotal: window._DB.g('medWasteProd').length };
  });
  console.log('Med Waste:', JSON.stringify(results.medWasteProd));

  // ── Module 12: Wastewater Production (6 records) ──
  console.log('\n=== Module 12: Wastewater Production ===');
  // Fields: m-ww-date, m-ww-shift, m-ww-status, m-ww-inflow, m-ww-treated, m-ww-outflow, m-ww-ophrs, m-ww-downtime, m-ww-remarks
  results.wwProd = await page.evaluate(() => {
    const wws = [
      {date:'2026-01-31',shift:'AM Shift',inflow:85.5,treated:85.5,outflow:83.0,ophrs:8,remarks:'Full month operation'},
      {date:'2026-02-07',shift:'AM Shift',inflow:78.2,treated:78.2,outflow:76.0,ophrs:8,remarks:''},
      {date:'2026-02-14',shift:'AM Shift',inflow:82.0,treated:80.0,outflow:78.0,ophrs:7,remarks:'2m3 bypass — pump downtime'},
      {date:'2026-02-21',shift:'AM Shift',inflow:79.5,treated:79.5,outflow:77.5,ophrs:8,remarks:''},
      {date:'2026-02-28',shift:'AM Shift',inflow:86.0,treated:86.0,outflow:84.0,ophrs:8,remarks:'Dengue admissions spike'},
      {date:'2026-03-07',shift:'AM Shift',inflow:80.5,treated:80.5,outflow:78.5,ophrs:8,remarks:''},
    ];
    let count = 0;
    for (const w of wws) {
      try {
        openWWProdModal();
        const s = id => document.getElementById(id);
        s('m-ww-date').value = w.date;
        s('m-ww-shift').value = w.shift;
        s('m-ww-inflow').value = w.inflow;
        s('m-ww-treated').value = w.treated;
        s('m-ww-outflow').value = w.outflow;
        s('m-ww-ophrs').value = w.ophrs;
        s('m-ww-remarks').value = w.remarks;
        saveWWProd();
        count++;
      } catch(e) { console.warn('WWProd error:', e.message); }
    }
    navigate('wwprod');
    return { target: 6, inserted: count, dbTotal: window._DB.g('wwProd').length };
  });
  console.log('WW Prod:', JSON.stringify(results.wwProd));

  // ── Final Verification ──
  console.log('\n=== Final Verification ===');
  const finalCounts = await page.evaluate(() => {
    navigate('dashboard');
    if (typeof renderDash === 'function') renderDash();
    const g = window._DB.g;
    const counts = {
      wo: g('wo').length,
      assets: g('assets').length,
      inventory: g('inventory').length,
      issuance: g('issuance').length,
      waste: g('waste').length,
      safety: g('safety').length,
      projects: g('projects').length,
      waterLogs: g('waterLogs').length,
      waterTank: g('waterTank').length,
      effluent: g('effluent').length,
      medWasteProd: g('medWasteProd').length,
      wwProd: g('wwProd').length,
    };
    counts.TOTAL = Object.values(counts).reduce((s, n) => s + n, 0);
    return counts;
  });
  console.log('Final DB counts:', JSON.stringify(finalCounts, null, 2));

  // Take a screenshot of the dashboard
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'D:/DOPMC/cmms/.playwright-mcp/final-dashboard.png', fullPage: false });
  console.log('Screenshot saved to .playwright-mcp/final-dashboard.png');

  // Print summary table
  console.log('\n=== SUMMARY ===');
  console.log('Module            | Target | Inserted | DB Total');
  console.log('------------------|--------|----------|--------');
  const mods = [
    ['Work Orders', 'wo', 15],
    ['Assets', 'assets', 15],
    ['Inventory', 'inventory', 12],
    ['Issuance', 'issuance', 8],
    ['Waste', 'waste', 10],
    ['Safety', 'safety', 8],
    ['Projects', 'projects', 5],
    ['Water Logs', 'waterLogs', 12],
    ['Water Tank', 'waterTank', 8],
    ['Effluent', 'effluent', 6],
    ['Med Waste', 'medWasteProd', 6],
    ['WW Prod', 'wwProd', 6],
  ];
  let totalTarget = 0, totalInserted = 0;
  for (const [name, key, target] of mods) {
    const ins = results[key]?.inserted || 0;
    const db = finalCounts[key] || 0;
    totalTarget += target;
    totalInserted += ins;
    console.log(`${name.padEnd(18)}| ${String(target).padEnd(7)}| ${String(ins).padEnd(9)}| ${db}`);
  }
  console.log('------------------|--------|----------|--------');
  console.log(`${'GRAND TOTAL'.padEnd(18)}| ${String(totalTarget).padEnd(7)}| ${String(totalInserted).padEnd(9)}| ${finalCounts.TOTAL}`);

  // Keep browser open for a bit to let syncing complete
  console.log('\nWaiting 10s for Firestore sync...');
  await page.waitForTimeout(10000);

  await browser.close();
  console.log('Done!');
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
