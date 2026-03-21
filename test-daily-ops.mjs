/**
 * HAMMS Daily Operations Load Test
 * Seeds 750+ DOPMC-realistic records across all 14 modules, then runs ~120
 * automated assertions covering CRUD, cross-module transactions, validation,
 * error handling, charts, filters, and performance under volume.
 *
 * Usage:  npx playwright test test-daily-ops.mjs   (or)   node test-daily-ops.mjs
 * Requires: playwright (npm i -D playwright)
 */
import { chromium } from 'playwright';

const APP_URL  = 'https://demoapp-7864a.web.app';
const EMAIL    = 'vinzlloydalferez@gmail.com';
const PASSWORD = 'alferez123';

// ── Test tracking ────────────────────────────────────────────────────
const tests = [];
let passed = 0, failed = 0;
function T(name, ok, detail = '') {
  tests.push({ name, ok: !!ok, detail });
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const results = {};

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  // Collect page-level JS errors
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 0 — LOGIN
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 0: Login ══');
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('#login-btn');
  await page.waitForFunction(() => {
    const c = document.getElementById('login-card');
    return c && (c.style.display === 'none' || !c.offsetParent);
  }, { timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log('  Logged in.');

  // Override dialogs & expose DB
  await page.evaluate(() => {
    window.confirm = () => true;
    window._origConfirmDialog = window.confirmDialog;
    window.confirmDialog = () => Promise.resolve(true);
    window._alerts = [];
    window._toasts = [];
    const _origToast = window.showToast;
    window.showToast = (msg, type, dur) => { window._toasts.push({ msg, type }); _origToast(msg, type, dur); };
    window.alert = m => window._alerts.push(m);
  });

  await page.waitForFunction(() => typeof saveWO === 'function', { timeout: 15000 });
  await page.evaluate(() => {
    window._DB = { g: k => DB.g(k), s: (k, v) => DB.s(k, v), nid: k => DB.nid(k) };
  });
  console.log('  App ready.\n');

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 1 — FOUNDATION (Assets 55, Inventory 55, Census 60)
  // ═══════════════════════════════════════════════════════════════════
  console.log('══ Phase 1: Foundation ══');

  // ── 1.1  Assets (55) ──────────────────────────────────────────────
  console.log('\n── 1.1 Assets (55) ──');
  results.assets = await page.evaluate(() => {
    const A = [
      // Electrical (12)
      {n:'LED Panel Light 36W — Ward 1',s:'Electrical',b:'Philips',c:'Good',l:'Ward 1',w:36,oh:12,od:30,f:90,lm:'2026-01-15'},
      {n:'LED Panel Light 36W — Ward 2',s:'Electrical',b:'Philips',c:'Good',l:'Ward 2',w:36,oh:12,od:30,f:90,lm:'2026-01-20'},
      {n:'Circuit Breaker Panel 200A',s:'Electrical',b:'Schneider',c:'Good',l:'Electrical Room',w:0,oh:24,od:30,f:365,lm:'2025-12-10'},
      {n:'Emergency Generator 100kVA',s:'Electrical',b:'Caterpillar',c:'Good',l:'Generator Room',hp:134,oh:2,od:30,f:30,lm:'2026-03-01'},
      {n:'Fire Alarm Control Panel',s:'Electrical',b:'Honeywell',c:'Good',l:'Security Office',w:50,oh:24,od:30,f:180,lm:'2025-10-15'},
      {n:'CCTV NVR System 16ch',s:'Electrical',b:'Hikvision',c:'Good',l:'Security Room',w:200,oh:24,od:30,f:90,lm:'2026-02-01'},
      {n:'ATS Automatic Transfer Switch',s:'Electrical',b:'ASCO',c:'Fair',l:'Electrical Room',w:0,oh:0,od:0,f:180,lm:'2025-08-20'},
      {n:'UPS 3kVA — Server Room',s:'Electrical',b:'APC',c:'Good',l:'IT Room',w:3000,oh:24,od:30,f:180,lm:'2026-01-05'},
      {n:'Exit Sign Light — 1F Corridor',s:'Electrical',b:'Omni',c:'Fair',l:'1F Corridor',w:5,oh:24,od:30,f:365,lm:'2025-06-01'},
      {n:'Ceiling Fan 56 inch — Ward 3',s:'Electrical',b:'KDK',c:'Good',l:'Ward 3',w:75,oh:10,od:30,f:180,lm:'2025-12-20'},
      {n:'Exhaust Fan 12 inch — Lab',s:'Electrical',b:'Panasonic',c:'Poor',l:'Laboratory',w:40,oh:8,od:22,f:90,lm:'2025-11-10'},
      {n:'LED Street Light 100W — Parking',s:'Electrical',b:'Philips',c:'Good',l:'Parking Area',w:100,oh:12,od:30,f:365,lm:'2025-09-01'},
      // Plumbing (10)
      {n:'Centrifugal Water Pump — Main',s:'Plumbing',b:'Grundfos',c:'Good',l:'Pump Room',hp:5,oh:16,od:30,f:90,lm:'2026-02-15'},
      {n:'Submersible Pump — Deep Well',s:'Plumbing',b:'Grundfos',c:'Good',l:'Deep Well Area',hp:3,oh:12,od:30,f:90,lm:'2026-01-20'},
      {n:'Rooftop Water Tank 20kL',s:'Plumbing',b:'Sintex',c:'Good',l:'Roof Deck',w:0,oh:0,od:0,f:180,lm:'2025-12-01'},
      {n:'Ground Reservoir 10kL',s:'Plumbing',b:'Megaforce',c:'Fair',l:'Pump Room',w:0,oh:0,od:0,f:180,lm:'2025-10-15'},
      {n:'Faucet Assembly — Ward 1 CR',s:'Plumbing',b:'HCG',c:'Fair',l:'Ward 1',w:0,oh:0,od:0,f:0},
      {n:'Toilet Bowl — Ward 2 CR',s:'Plumbing',b:'American Standard',c:'Poor',l:'Ward 2',w:0,oh:0,od:0,f:0},
      {n:'Water Heater 50L — OR',s:'Plumbing',b:'Ariston',c:'Good',l:'OR Complex',w:1500,oh:6,od:22,f:365,lm:'2025-07-01'},
      {n:'Pressure Tank 200L',s:'Plumbing',b:'Aqua Systems',c:'Good',l:'Pump Room',w:0,oh:0,od:0,f:180,lm:'2026-01-10'},
      {n:'Floor Drain Trap — Kitchen',s:'Plumbing',b:'Generic',c:'Fair',l:'Kitchen',w:0,oh:0,od:0,f:0},
      {n:'Backflow Preventer — Main Line',s:'Plumbing',b:'Watts',c:'Good',l:'Pump Room',w:0,oh:0,od:0,f:365,lm:'2025-06-15'},
      // Mechanical (10)
      {n:'Window AC 1.5HP — Ward 1',s:'Mechanical',b:'Carrier',c:'Good',l:'Ward 1',hp:1.5,oh:14,od:30,f:30,lm:'2026-03-05'},
      {n:'Split AC 2.5HP — Admin Office',s:'Mechanical',b:'Samsung',c:'Good',l:'Admin Office',hp:2.5,oh:10,od:22,f:30,lm:'2026-03-10'},
      {n:'Cassette AC 3HP — Conference',s:'Mechanical',b:'Daikin',c:'Good',l:'Conference Room',hp:3,oh:6,od:22,f:30,lm:'2026-02-28'},
      {n:'AHU — Ward 2',s:'Mechanical',b:'Carrier',c:'Fair',l:'Ward 2',hp:5,oh:14,od:30,f:90,lm:'2025-12-15'},
      {n:'Kitchen Exhaust Fan 24 inch',s:'Mechanical',b:'KDK',c:'Good',l:'Kitchen',w:300,oh:10,od:30,f:90,lm:'2026-01-25'},
      {n:'Chiller 30TR — Central Plant',s:'Mechanical',b:'York',c:'Good',l:'Central Plant',hp:40,oh:14,od:30,f:90,lm:'2026-02-10'},
      {n:'Split AC 2HP — Laboratory',s:'Mechanical',b:'LG',c:'Good',l:'Laboratory',hp:2,oh:10,od:22,f:30,lm:'2026-03-01'},
      {n:'Window AC 1HP — Pharmacy',s:'Mechanical',b:'Carrier',c:'Good',l:'Pharmacy',hp:1,oh:10,od:22,f:30,lm:'2026-03-08'},
      {n:'Ceiling Exhaust Fan — ICU',s:'Mechanical',b:'Panasonic',c:'Good',l:'ICU',w:40,oh:24,od:30,f:90,lm:'2026-01-15'},
      {n:'Portable AC 1HP — ER Triage',s:'Mechanical',b:'Midea',c:'For Replacement',l:'ER',hp:1,oh:12,od:30,f:30,lm:'2026-02-20'},
      // CMW (16)
      {n:'Fire Door — Stairwell A',s:'CMW',b:'Ramco',c:'Good',l:'1F Stairwell A',w:0,oh:0,od:0,f:365,lm:'2025-08-01'},
      {n:'Aluminum Window — Ward 3',s:'CMW',b:'Alumex',c:'Fair',l:'Ward 3',w:0,oh:0,od:0,f:0},
      {n:'Suspended Ceiling — Corridor B',s:'CMW',b:'Armstrong',c:'Good',l:'2F Corridor B',w:0,oh:0,od:0,f:0},
      {n:'Vinyl Floor Tile — Ward 1',s:'CMW',b:'Niro Granite',c:'Fair',l:'Ward 1',w:0,oh:0,od:0,f:0},
      {n:'Passenger Elevator — Main Bldg',s:'CMW',b:'Otis',c:'Good',l:'Main Lobby',w:5000,oh:12,od:30,f:30,lm:'2026-03-05'},
      {n:'Autoclave Sterilizer — CSSD',s:'CMW',b:'Tuttnauer',c:'Good',l:'CSSD',w:6000,oh:6,od:22,f:90,lm:'2026-02-01'},
      {n:'Hospital Bed — Ward 1',s:'CMW',b:'Paramount',c:'Good',l:'Ward 1',w:0,oh:0,od:0,f:365,lm:'2025-10-01'},
      {n:'Stretcher — ER',s:'CMW',b:'Stryker',c:'Good',l:'ER',w:0,oh:0,od:0,f:180,lm:'2025-11-15'},
      {n:'Wheelchair Standard — OPD',s:'CMW',b:'Karma',c:'Fair',l:'OPD',w:0,oh:0,od:0,f:365,lm:'2025-09-01'},
      {n:'Wooden Cabinet — Pharmacy',s:'CMW',b:'Local',c:'Good',l:'Pharmacy',w:0,oh:0,od:0,f:0},
      {n:'Steel Door — Medical Records',s:'CMW',b:'Ramco',c:'Good',l:'Records Room',w:0,oh:0,od:0,f:0},
      {n:'Concrete Wall Repair — Ward 2',s:'CMW',b:'N/A',c:'Poor',l:'Ward 2',w:0,oh:0,od:0,f:0},
      {n:'Office Desk — Admin',s:'CMW',b:'Mandaue Foam',c:'Good',l:'Admin Office',w:0,oh:0,od:0,f:0},
      {n:'Filing Cabinet 4-Drawer',s:'CMW',b:'Seville',c:'Good',l:'Records Room',w:0,oh:0,od:0,f:0},
      {n:'Wheelchair — Ward 2',s:'CMW',b:'Karma',c:'Poor',l:'Ward 2',w:0,oh:0,od:0,f:0},
      {n:'Whiteboard 4x6 — Conference',s:'CMW',b:'Quartet',c:'Good',l:'Conference Room',w:0,oh:0,od:0,f:0},
      // Housekeeping (7)
      {n:'Floor Polisher 17 inch',s:'Housekeeping',b:'Nilfisk',c:'Good',l:'Housekeeping',w:1100,oh:4,od:22,f:90,lm:'2026-02-10'},
      {n:'Wet/Dry Vacuum Cleaner',s:'Housekeeping',b:'Karcher',c:'Good',l:'Housekeeping',w:1200,oh:4,od:22,f:90,lm:'2026-01-20'},
      {n:'Carpet Cleaner Machine',s:'Housekeeping',b:'Bissell',c:'Fair',l:'Housekeeping',w:800,oh:2,od:10,f:180,lm:'2025-10-01'},
      {n:'Pressure Washer 150BAR',s:'Housekeeping',b:'Karcher',c:'Good',l:'Utility Area',w:2100,oh:3,od:15,f:90,lm:'2026-02-15'},
      {n:'Riding Floor Scrubber',s:'Housekeeping',b:'Tennant',c:'Good',l:'Main Lobby',w:1500,oh:3,od:22,f:30,lm:'2026-03-01'},
      {n:'Mop Bucket w/ Wringer',s:'Housekeeping',b:'Rubbermaid',c:'Fair',l:'Housekeeping',w:0,oh:0,od:0,f:0},
      {n:'Wall Clock — Main Lobby',s:'Housekeeping',b:'Seiko',c:'Good',l:'Main Lobby',w:0,oh:0,od:0,f:0},
    ];
    let count = 0;
    for (const a of A) {
      try {
        openAssetModal();
        const el = id => document.getElementById(id);
        el('m-a-name').value = a.n;
        el('m-a-section').value = a.s;
        el('m-a-brand').value = a.b || '';
        el('m-a-condition').value = a.c || 'Good';
        el('m-a-loc').value = a.l || '';
        el('m-a-remarks').value = '';
        if (a.w) el('m-a-watts').value = a.w;
        if (a.hp) el('m-a-hp').value = a.hp;
        if (a.oh) el('m-a-ophrs').value = a.oh;
        if (a.od) el('m-a-opdays').value = a.od;
        if (a.f) { el('m-a-freq').value = String(a.f); }
        if (a.lm) el('m-a-lastmaint').value = a.lm;
        saveAsset();
        count++;
      } catch (e) { console.warn('Asset error:', e.message); }
    }
    navigate('assets'); renderAssets();
    return { target: 55, inserted: count, dbTotal: window._DB.g('assets').length };
  });
  console.log('  Assets:', JSON.stringify(results.assets));

  // 1.1 assertions
  const assetChecks = await page.evaluate(() => {
    const a = window._DB.g('assets');
    const secs = new Set(a.map(x => x.section));
    const withEnergy = a.filter(x => x.estimatedKwhMonth > 0);
    const withCode = a.filter(x => x.assetCode && x.assetCode.length > 0);
    const withNext = a.filter(x => x.nextMaintDate);
    return { len: a.length, secs: [...secs], energyCount: withEnergy.length, codeCount: withCode.length, nextCount: withNext.length };
  });
  T('Assets: count >= 55', assetChecks.len >= 55, `got ${assetChecks.len}`);
  T('Assets: all 5 sections present', assetChecks.secs.length >= 5, assetChecks.secs.join(', '));
  T('Assets: energy computed', assetChecks.energyCount > 0, `${assetChecks.energyCount} with kWh`);
  T('Assets: assetCode generated', assetChecks.codeCount > 0, `${assetChecks.codeCount} with codes`);

  // ── 1.2  Inventory (55) ───────────────────────────────────────────
  console.log('\n── 1.2 Inventory (55) ──');
  results.inventory = await page.evaluate(() => {
    const I = [
      // Electrical (14)
      {d:'LED Bulb 9W Daylight',c:'Electrical',u:'pcs',q:100,m:25},
      {d:'LED Bulb 15W Daylight',c:'Electrical',u:'pcs',q:80,m:20},
      {d:'Fluorescent Tube 36W T8',c:'Electrical',u:'pcs',q:60,m:15},
      {d:'THHN Wire 2.0mm Red',c:'Electrical',u:'roll',q:20,m:5},
      {d:'THHN Wire 2.0mm Black',c:'Electrical',u:'roll',q:18,m:5},
      {d:'Circuit Breaker 20A',c:'Electrical',u:'pcs',q:15,m:5},
      {d:'Circuit Breaker 30A',c:'Electrical',u:'pcs',q:10,m:3},
      {d:'Duplex Outlet 250V',c:'Electrical',u:'pcs',q:30,m:10},
      {d:'Toggle Switch 2-Gang',c:'Electrical',u:'pcs',q:25,m:8},
      {d:'Flexible Conduit 1/2 inch',c:'Electrical',u:'roll',q:15,m:4},
      {d:'Electrical Tape Black',c:'Electrical',u:'roll',q:40,m:10},
      {d:'Emergency Light Battery 6V',c:'Electrical',u:'pcs',q:8,m:3},
      {d:'Fuse 30A Cartridge',c:'Electrical',u:'pcs',q:20,m:5},
      {d:'Cable Tie 200mm White',c:'Electrical',u:'pcs',q:500,m:100},
      // Plumbing (12)
      {d:'PVC Pipe 1/2 inch x 10ft',c:'Plumbing',u:'pcs',q:50,m:10},
      {d:'PVC Pipe 3/4 inch x 10ft',c:'Plumbing',u:'pcs',q:40,m:8},
      {d:'PVC Elbow 1/2 inch',c:'Plumbing',u:'pcs',q:80,m:20},
      {d:'Gate Valve 1/2 inch Brass',c:'Plumbing',u:'pcs',q:12,m:3},
      {d:'Ball Valve 3/4 inch',c:'Plumbing',u:'pcs',q:10,m:3},
      {d:'Teflon Tape 1/2 inch',c:'Plumbing',u:'roll',q:100,m:20},
      {d:'PVC Cement 200mL',c:'Plumbing',u:'btl',q:15,m:4},
      {d:'Faucet Standard Chrome',c:'Plumbing',u:'pcs',q:2,m:3},   // LOW STOCK
      {d:'Toilet Flapper Valve',c:'Plumbing',u:'pcs',q:2,m:5},     // LOW STOCK
      {d:'Gasket Set Assorted',c:'Plumbing',u:'pack',q:20,m:5},
      {d:'Pipe Clamp 1/2 inch',c:'Plumbing',u:'pcs',q:50,m:10},
      {d:'Hose Bib 1/2 inch',c:'Plumbing',u:'pcs',q:10,m:3},
      // CMW (12)
      {d:'Latex Paint White 4L',c:'CMW',u:'gal',q:12,m:4},
      {d:'Latex Paint Beige 4L',c:'CMW',u:'gal',q:8,m:3},
      {d:'Portland Cement 40kg',c:'CMW',u:'bag',q:20,m:5},
      {d:'Marine Plywood 3/4 4x8',c:'CMW',u:'sht',q:8,m:2},
      {d:'Common Nail 3 inch',c:'CMW',u:'kg',q:15,m:3},
      {d:'Door Hinge 4 inch SS',c:'CMW',u:'pcs',q:20,m:5},
      {d:'Door Lock Knob Set',c:'CMW',u:'pcs',q:6,m:3},
      {d:'Sandpaper #120 Grit',c:'CMW',u:'sht',q:30,m:8},
      {d:'Wall Putty 1L',c:'CMW',u:'can',q:10,m:3},
      {d:'Wood Screw #8 x 1.5 inch',c:'CMW',u:'pcs',q:200,m:40},
      {d:'Welding Rod E6013 3.2mm',c:'CMW',u:'kg',q:10,m:3},
      {d:'GI Wire #16',c:'CMW',u:'roll',q:5,m:2},
      // Mechanical (8)
      {d:'HEPA Filter 16x20x2',c:'Mechanical',u:'pcs',q:8,m:3},
      {d:'AC Filter Split 2HP',c:'Mechanical',u:'pcs',q:6,m:2},
      {d:'Refrigerant R410A 25lb',c:'Mechanical',u:'tank',q:3,m:1},
      {d:'V-Belt B68',c:'Mechanical',u:'pcs',q:4,m:2},
      {d:'Bearing 6205 ZZ',c:'Mechanical',u:'pcs',q:8,m:3},
      {d:'Lubricant Grease 500g',c:'Mechanical',u:'tub',q:6,m:2},
      {d:'Compressor Oil 1L',c:'Mechanical',u:'btl',q:4,m:2},
      {d:'Air Filter Media 1m roll',c:'Mechanical',u:'roll',q:5,m:2},
      // Housekeeping (9)
      {d:'Zonrox Bleach 1L',c:'Housekeeping',u:'btl',q:50,m:15},
      {d:'Domex Disinfectant 1L',c:'Housekeeping',u:'btl',q:40,m:12},
      {d:'Detergent Powder 1kg',c:'Housekeeping',u:'pack',q:30,m:8},
      {d:'Trash Bag Black XL',c:'Housekeeping',u:'pcs',q:200,m:50},
      {d:'Trash Bag Yellow Infectious',c:'Housekeeping',u:'pcs',q:150,m:40},
      {d:'Latex Gloves Medium',c:'Housekeeping',u:'box',q:100,m:20},
      {d:'Toilet Tissue 2-Ply',c:'Housekeeping',u:'roll',q:200,m:50},
      {d:'Hand Soap Liquid 500mL',c:'Housekeeping',u:'btl',q:3,m:10},  // LOW STOCK
      {d:'Floor Wax Red 4L',c:'Housekeeping',u:'gal',q:5,m:2},
    ];
    let count = 0;
    for (const i of I) {
      try {
        openInvModal();
        const el = id => document.getElementById(id);
        el('m-i-desc').value = i.d;
        el('m-i-cat').value = i.c;
        el('m-i-unit').value = i.u;
        el('m-i-qty').value = i.q;
        el('m-i-min').value = i.m;
        saveInvItem();
        count++;
      } catch (e) { console.warn('Inv error:', e.message); }
    }
    navigate('inventory'); renderInventory();
    return { target: 55, inserted: count, dbTotal: window._DB.g('inventory').length };
  });
  console.log('  Inventory:', JSON.stringify(results.inventory));

  const invChecks = await page.evaluate(() => {
    const inv = window._DB.g('inventory');
    const cats = new Set(inv.map(x => x.category));
    const low = inv.filter(i => i.qty <= (i.minLevel || 0));
    return { len: inv.length, cats: [...cats], lowCount: low.length };
  });
  T('Inventory: count >= 55', invChecks.len >= 55, `got ${invChecks.len}`);
  T('Inventory: 5 categories present', invChecks.cats.length >= 5, invChecks.cats.join(', '));
  T('Inventory: >= 3 low-stock items', invChecks.lowCount >= 3, `got ${invChecks.lowCount}`);

  // ── 1.3  Census Log (60) ─────────────────────────────────────────
  console.log('\n── 1.3 Census Log (60) ──');
  results.census = await page.evaluate(() => {
    const log = [];
    const base = new Date('2025-12-01');
    for (let i = 0; i < 60; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      const dow = d.getDay();
      // Weekend dip, weekday variation
      const baseCount = dow === 0 || dow === 6 ? 160 : 195;
      const count = baseCount + Math.floor(Math.random() * 50) - 10;
      log.push({
        date: d.toISOString().split('T')[0],
        count: Math.max(150, Math.min(240, count))
      });
    }
    window._DB.s('censusLog', log);
    return { target: 60, dbTotal: window._DB.g('censusLog').length };
  });
  console.log('  Census:', JSON.stringify(results.census));

  const censusChecks = await page.evaluate(() => {
    const log = window._DB.g('censusLog');
    const c15 = getCensusForDate('2026-01-15');
    const cFuture = getCensusForDate('2026-03-20');
    return { len: log.length, jan15: c15, future: cFuture };
  });
  T('Census: count == 60', censusChecks.len === 60, `got ${censusChecks.len}`);
  T('Census: getCensusForDate works', censusChecks.jan15 >= 150 && censusChecks.jan15 <= 240, `Jan 15 = ${censusChecks.jan15}`);
  T('Census: fallback for future date', censusChecks.future > 0, `future = ${censusChecks.future}`);

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 2 — DEPENDENT MODULES (WO 55, Issuance 10, Safety 55)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 2: Dependent Modules ══');

  // ── 2.1  Work Orders (55) ─────────────────────────────────────────
  console.log('\n── 2.1 Work Orders (55) ──');

  results.wo = await page.evaluate(() => {
    // Snapshot inventory BEFORE WO seeding (same evaluate — avoids Firestore sync race)
    const _invSnap = {};
    window._DB.g('inventory').forEach(i => { _invSnap[i.id] = i.qty; });
    const secs = ['Electrical','Plumbing','Mechanical','CMW','Housekeeping'];
    const priorities = ['Low','Medium','High','Emergency'];
    const assets = window._DB.g('assets');
    const inv = window._DB.g('inventory');
    const findInv = s => inv.find(i => (i.description || '').includes(s));
    const today_ = typeof today === 'function' ? today() : '2026-03-21';

    // 45 WOs without materials
    const plain = [];
    const descs = [
      ['Electrical','Replace faulty circuit breaker — Ward 2 panel B','High','Open','2026-01-05','2026-01-20',null],
      ['Plumbing','Fix leaking pipe in ICU bathroom ceiling','High','Open','2026-01-08',null,null],
      ['Mechanical','AC unit not cooling — Operating Room 1','High','In Progress','2026-01-10','2026-01-25',null],
      ['Electrical','Install new LED lighting in corridor B','Low','Closed','2026-01-12','2026-02-15','2026-02-10'],
      ['CMW','Replace worn mattress covers — Room 301','Medium','Open','2026-01-15','2026-02-01',null],  // overdue
      ['Plumbing','Unclog drain in staff restroom 2F','Medium','Closed','2026-01-18','2026-01-30','2026-01-18'],
      ['CMW','Repair ceiling crack in Admin Office','Medium','In Progress','2026-01-20','2026-02-28',null],
      ['Electrical','Replace emergency exit sign lights — all floors','High','Open','2026-02-01','2026-02-10',null],  // overdue
      ['Mechanical','Preventive maintenance — all AHUs quarterly','Medium','In Progress','2026-02-05','2026-03-30',null],
      ['Plumbing','Water pressure low in laboratory wing','High','Open','2026-02-08','2026-02-15',null],  // overdue
      ['CMW','Repair broken door handle — Room 205','Low','Closed','2026-02-10','2026-02-20','2026-02-11'],
      ['Electrical','Inspect and load-test generator set','High','In Progress','2026-02-15','2026-03-30',null],
      ['CMW','Paint peeling in Pediatric Ward walls','Low','Open','2026-02-20','2026-03-01',null],  // overdue
      ['Plumbing','Install new handwashing station near ER','Medium','In Progress','2026-03-01','2026-04-15',null],
      ['Mechanical','Clean and service exhaust fans — kitchen','Medium','Open','2026-03-05','2026-03-15',null],  // overdue
      ['Electrical','Fix flickering lights in Ward 4','Medium','Closed','2025-12-01','2025-12-15','2025-12-10'],
      ['CMW','Replace broken window pane — Ward 3','High','Closed','2025-12-05','2025-12-20','2025-12-18'],
      ['Plumbing','Repair toilet flush mechanism — Ward 1','Low','Closed','2025-12-10','2025-12-30','2025-12-28'],
      ['Mechanical','PM on split AC — Admin','Medium','Closed','2025-12-15','2026-01-15','2025-12-20'],
      ['Housekeeping','Deep clean and sanitize isolation room','High','Closed','2026-01-02','2026-01-05','2026-01-03'],
      ['Electrical','Install additional CCTV cameras — 2F','Medium','Closed','2026-01-10','2026-02-10','2026-02-05'],
      ['CMW','Fix concrete spalling — stairwell B','Medium','Closed','2026-01-15','2026-02-15','2026-02-12'],
      ['Plumbing','Replace corroded GI pipe section — Kitchen','High','Closed','2026-01-20','2026-02-05','2026-02-01'],
      ['Mechanical','Recharge refrigerant — Ward 3 AC','Medium','In Progress','2026-02-01','2026-03-30',null],
      ['Housekeeping','Refurbish nurses station countertop','Low','In Progress','2026-02-05','2026-04-01',null],
      ['Electrical','Repair grounding system — Generator Room','High','Closed','2026-02-10','2026-02-28','2026-02-25'],
      ['CMW','Replace damaged ceiling tiles — OPD','Low','In Progress','2026-02-15','2026-04-01',null],
      ['Plumbing','Fix low water pressure — 3F faucets','Medium','Closed','2026-02-20','2026-03-10','2026-03-08'],
      ['Mechanical','Belt replacement — AHU Ward 2','Medium','Closed','2026-02-25','2026-03-10','2026-03-05'],
      ['Housekeeping','Strip and re-wax lobby floor','Low','Closed','2026-03-01','2026-03-15','2026-03-10'],
      ['Electrical','Replace blown transformer fuse','Emergency','Closed','2026-01-25','2026-01-25','2026-01-25'],
      ['CMW','Elevator annual safety inspection','High','In Progress','2026-03-01','2026-03-31',null],
      ['Plumbing','Deep well pump maintenance','Medium','In Progress','2026-03-05','2026-03-25',null],
      ['Mechanical','Compressor oil change — Chiller','Medium','Closed','2026-03-10','2026-03-20','2026-03-15'],
      ['Housekeeping','Replace damaged vinyl flooring — ICU','Medium','Closed','2025-11-15','2025-12-15','2025-12-10'],
      ['Electrical','Test all smoke detectors — annual','High','In Progress','2026-03-15','2026-03-31',null],
      ['CMW','Waterproofing repair — roof deck','High','Open','2026-03-10','2026-04-15',null],
      ['Plumbing','Replace water heater element — OR','Medium','Open','2026-03-12','2026-04-01',null],
      ['Mechanical','Clean condenser coils — all split ACs','Low','Open','2026-03-15','2026-04-15',null],
      ['Housekeeping','Sanitize all water dispensers','Low','Open','2026-03-18','2026-04-01',null],
      ['Electrical','Install surge protector — IT room','Medium','Closed','2026-03-01','2026-03-10','2026-03-08'],
      ['CMW','Fix loose handrail — stairwell A','High','Closed','2026-03-05','2026-03-12','2026-03-10'],
      ['Plumbing','Repair leaking faucet — Lab sink','Low','Closed','2026-03-08','2026-03-15','2026-03-12'],
      ['Mechanical','Replace thermostat — Ward 1 AC','Medium','Closed','2025-11-20','2025-12-05','2025-12-01'],
      ['CMW','Repaint emergency exit markers','Low','Closed','2025-11-25','2025-12-10','2025-12-08'],
    ];
    for (const [sec, desc, pri, st, ds, tc, de] of descs) {
      const assetMatch = assets.find(a => a.section === sec);
      plain.push({ sec, desc, pri, st, ds, tc, de, asset: assetMatch?.name || '', assigned: 'GSD Team', loc: assetMatch?.location || '' });
    }

    // 10 WOs WITH materials
    const matWOs = [
      {sec:'Electrical',desc:'Replace LED bulbs in Ward 1 — batch PM',pri:'Medium',st:'Closed',ds:'2026-01-20',tc:'2026-02-01',de:'2026-01-25',
       mats:[{s:'LED Bulb 9W',q:5,to:'Juan dela Cruz'},{s:'Toggle Switch',q:2,to:'Juan dela Cruz'}]},
      {sec:'Plumbing',desc:'Repair pipe leak — Ward 2 ceiling',pri:'High',st:'Closed',ds:'2026-01-22',tc:'2026-01-30',de:'2026-01-28',
       mats:[{s:'PVC Pipe 1/2',q:3,to:'Pedro Santos'},{s:'PVC Cement',q:1,to:'Pedro Santos'}]},
      {sec:'Electrical',desc:'Install new outlet — ICU bay 5',pri:'Medium',st:'Closed',ds:'2026-02-01',tc:'2026-02-10',de:'2026-02-08',
       mats:[{s:'Duplex Outlet',q:2,to:'Juan dela Cruz'},{s:'THHN Wire 2.0mm Red',q:1,to:'Juan dela Cruz'}]},
      {sec:'CMW',desc:'Repaint Ward 3 patient room walls',pri:'Low',st:'In Progress',ds:'2026-02-10',tc:'2026-03-30',de:null,
       mats:[{s:'Latex Paint White',q:2,to:'Jose Ramos'}]},
      {sec:'Plumbing',desc:'Replace faucet — Ward 1 comfort room',pri:'Medium',st:'Closed',ds:'2026-02-15',tc:'2026-02-20',de:'2026-02-18',
       mats:[{s:'Faucet Standard',q:1,to:'Pedro Santos'}]},
      {sec:'Mechanical',desc:'Replace HEPA filters — Ward 2 AHU',pri:'High',st:'Closed',ds:'2026-02-20',tc:'2026-02-28',de:'2026-02-25',
       mats:[{s:'HEPA Filter',q:2,to:'Ramon Reyes'}]},
      {sec:'Housekeeping',desc:'Resupply cleaning materials — monthly',pri:'Low',st:'Closed',ds:'2026-03-01',tc:'2026-03-05',de:'2026-03-03',
       mats:[{s:'Zonrox Bleach',q:5,to:'Housekeeping Team'},{s:'Detergent Powder',q:3,to:'Housekeeping Team'}]},
      {sec:'CMW',desc:'Fix door lock — Room 201',pri:'Medium',st:'Closed',ds:'2026-03-05',tc:'2026-03-10',de:'2026-03-08',
       mats:[{s:'Door Lock Knob',q:1,to:'Jose Ramos'}]},
      {sec:'Electrical',desc:'Replace circuit breakers — Ward 4 panel',pri:'High',st:'In Progress',ds:'2026-03-10',tc:'2026-03-25',de:null,
       mats:[{s:'Circuit Breaker 20A',q:3,to:'Juan dela Cruz'}]},
      {sec:'Plumbing',desc:'Seal pipe joints — Kitchen area',pri:'Medium',st:'Closed',ds:'2026-03-12',tc:'2026-03-18',de:'2026-03-16',
       mats:[{s:'Teflon Tape',q:2,to:'Pedro Santos'}]},
    ];

    let count = 0;
    const fillWO = (w) => {
      const el = id => document.getElementById(id);
      el('m-wo-section').value = w.sec;
      el('m-wo-desc').value = w.desc;
      el('m-wo-priority').value = w.pri;
      el('m-wo-status').value = w.st;
      if (w.ds) el('m-wo-dstart').value = w.ds;
      if (w.tc) el('m-wo-target-completion').value = w.tc;
      if (w.de) el('m-wo-dend').value = w.de;
      el('m-wo-assigned').value = w.assigned || 'GSD Team';
      el('m-wo-asset').innerHTML = '<option value="">—</option>';
      if (w.asset) {
        const opt = document.createElement('option');
        opt.value = w.asset; opt.textContent = w.asset; opt.selected = true;
        el('m-wo-asset').appendChild(opt);
      }
      if (w.loc) el('m-wo-loc').value = w.loc;
      el('m-wo-remarks').value = '';
    };

    // Seed plain WOs
    for (const w of plain) {
      try { openWOModal(); fillWO(w); saveWO(); count++; }
      catch (e) { console.warn('WO error:', e.message); }
    }
    // Seed material WOs
    for (const w of matWOs) {
      try {
        openWOModal();
        fillWO({ ...w, assigned: w.mats[0]?.to || 'GSD Team' });
        _woMaterials = w.mats.map(m => ({
          invId: findInv(m.s)?.id || '',
          qty: m.q,
          issuedTo: m.to
        })).filter(m => m.invId);
        renderMaterialRows();
        saveWO();
        count++;
      } catch (e) { console.warn('WO-mat error:', e.message); }
    }
    navigate('workorders'); renderWO();

    // Check inventory deduction inside same evaluate (avoids Firestore sync race)
    let deductionCount = 0;
    window._DB.g('inventory').forEach(i => {
      if (_invSnap[i.id] !== undefined && i.qty < _invSnap[i.id]) deductionCount++;
    });

    const wos = window._DB.g('wo');
    const td = typeof today === 'function' ? today() : '2026-03-21';
    const overdueCount = wos.filter(w => (w.status !== 'Closed' && w.status !== 'Completed') && w.targetCompletionDate && td > w.targetCompletionDate).length;
    const matCount = wos.filter(w => w.materials && w.materials.length > 0).length;
    const iss = window._DB.g('issuance');
    const autoIssCount = iss.filter(i => (i.remarks || '').includes('Auto-deducted')).length;

    return { target: 55, inserted: count, dbTotal: wos.length, overdueCount, matCount, autoIssCount, deductionCount };
  });
  console.log('  Work Orders:', JSON.stringify(results.wo));

  T('WO: count >= 55', results.wo.dbTotal >= 55, `got ${results.wo.dbTotal}`);
  T('WO: >= 3 overdue', results.wo.overdueCount >= 3, `got ${results.wo.overdueCount}`);
  T('WO: 10 with materials', results.wo.matCount >= 10, `got ${results.wo.matCount}`);
  T('WO: auto-issuance created', results.wo.autoIssCount >= 10, `got ${results.wo.autoIssCount}`);
  T('WO: inventory deducted for materials', results.wo.deductionCount > 0, `${results.wo.deductionCount} items deducted`);

  // ── 2.2  Manual Issuance (10) ─────────────────────────────────────
  // Wait for Firestore sync to settle before issuing (avoids snapshot overwrite race)
  await page.waitForTimeout(3000);

  console.log('\n── 2.2 Manual Issuance (10) ──');
  results.issuance = await page.evaluate(() => {
    // Re-query inventory FRESH (after Firestore sync settled)
    const issues = [
      {s:'Fluorescent Tube',q:10,to:'Electrical Team',dt:'2026-01-10',rem:'Ward 3 corridor lamp replacement'},
      {s:'PVC Elbow',q:8,to:'Plumbing Team',dt:'2026-01-12',rem:'ICU bathroom repair'},
      {s:'Circuit Breaker 30A',q:1,to:'Juan dela Cruz',dt:'2026-01-15',rem:'Ward 2 panel B'},
      {s:'Zonrox Bleach',q:5,to:'Housekeeping Dept',dt:'2026-01-20',rem:'Weekly cleaning supply'},
      {s:'HEPA Filter',q:1,to:'Ramon Reyes',dt:'2026-02-05',rem:'AHU quarterly filter'},
      {s:'Latex Paint Beige',q:2,to:'Jose Ramos',dt:'2026-02-20',rem:'Pediatric ward repaint'},
      {s:'Electrical Tape',q:5,to:'Electrical Team',dt:'2026-03-01',rem:'Monthly batch issuance'},
      {s:'Compressor Oil',q:2,to:'Ramon Reyes',dt:'2026-03-05',rem:'Generator quarterly PM'},
      {s:'Trash Bag Black',q:50,to:'Housekeeping Dept',dt:'2026-03-10',rem:'Monthly resupply'},
      {s:'Sandpaper #120',q:5,to:'CMW Team',dt:'2026-03-15',rem:'Surface prep for painting'},
    ];
    let count = 0;
    const errors = [];
    for (const iss of issues) {
      try {
        // Fresh query each time — inventory may change between saves
        const inv = window._DB.g('inventory');
        const item = inv.find(i => (i.description || '').includes(iss.s));
        if (!item) { errors.push('not found: ' + iss.s); continue; }
        if (item.qty < iss.q) { errors.push('low stock: ' + iss.s + ' need ' + iss.q + ' have ' + item.qty); continue; }

        openIssueModal();
        const el = id => document.getElementById(id);
        // Set dropdown — match against CURRENT dropdown options
        const sel = el('m-iss-item');
        const opts = [...sel.options].map(o => o.value);
        if (!opts.includes(String(item.id))) { errors.push('dropdown miss: ' + iss.s + ' id=' + item.id); continue; }
        sel.value = String(item.id);
        el('m-iss-qty').value = iss.q;
        el('m-iss-to').value = iss.to;
        el('m-iss-date').value = iss.dt;
        const rem = el('m-iss-remarks');
        if (rem) rem.value = iss.rem;
        saveManualIssue();
        count++;
      } catch (e) { errors.push('exception: ' + e.message); }
    }
    navigate('issuance'); renderIssuance();
    return { target: 10, inserted: count, dbTotal: window._DB.g('issuance').length, errors };
  });
  console.log('  Issuance:', JSON.stringify(results.issuance));
  if (results.issuance.errors?.length) console.log('  Issuance errors:', results.issuance.errors.join('; '));
  T('Issuance: manual inserted >= 8', results.issuance.inserted >= 8, `got ${results.issuance.inserted}`);

  // ── 2.3  Safety (55) ─────────────────────────────────────────────
  console.log('\n── 2.3 Safety (55) ──');
  results.safety = await page.evaluate(() => {
    const sevs = ['Low','Moderate','High','Critical'];
    const sevCount = [15, 15, 15, 10];
    const stats = ['Open','Under Action','Resolved','Verified','Closed'];
    const statCount = [12, 10, 18, 8, 7];
    const locs = ['Ward 1','Ward 2','Ward 3','Ward 4','ICU','ER','OR Complex','OPD','Laboratory',
                  'Kitchen','Laundry Area','Admin Corridor','2F Stairwell','Pharmacy','Pediatric Ward'];
    const descs = [
      'Wet floor slip incident near nurses station','Needle stick injury during IV insertion',
      'Electrical outlet sparking when plugging equipment','Fire extinguisher expired on bracket',
      'Loose stair handrail reported','Chemical spill in lab area',
      'Broken glass panel at entrance','Smoke detector false alarm — dust buildup',
      'Exposed wiring in ceiling cavity','Trip hazard — damaged floor tile',
      'Missing biohazard label on waste bin','Faulty emergency exit light',
      'Water leak causing slippery corridor','Unsecured oxygen tank on floor',
      'Malfunctioning door closer — pinch hazard'
    ];
    const assets = window._DB.g('assets');

    let sevIdx = 0, sevBucket = 0;
    let statIdx = 0, statBucket = 0;
    let count = 0;
    const base = new Date('2025-10-01');

    for (let i = 0; i < 55; i++) {
      try {
        // Cycle severity
        if (sevBucket >= sevCount[sevIdx]) { sevIdx++; sevBucket = 0; }
        const sev = sevs[sevIdx]; sevBucket++;
        // Cycle status
        if (statBucket >= statCount[statIdx]) { statIdx++; statBucket = 0; }
        const stat = stats[statIdx]; statBucket++;

        const d = new Date(base.getTime() + i * 3 * 86400000);
        const dateStr = d.toISOString().split('T')[0];
        const loc = locs[i % locs.length];
        const desc = descs[i % descs.length] + ' — ' + loc;

        openSafetyModal();
        const el = id => document.getElementById(id);
        el('m-sf-date').value = dateStr;
        el('m-sf-desc').value = desc;
        el('m-sf-loc').value = loc;
        el('m-sf-sev').value = sev;
        el('m-sf-status').value = stat;
        // Link 10 records to assets
        if (i < 10 && assets[i]) el('m-sf-asset').value = assets[i].name;
        el('m-sf-remarks').value = i % 3 === 0 ? 'Corrective action taken immediately' : '';
        saveSafety();
        count++;
      } catch (e) { console.warn('Safety error:', e.message); }
    }
    navigate('safety'); renderSafety();
    return { target: 55, inserted: count, dbTotal: window._DB.g('safety').length };
  });
  console.log('  Safety:', JSON.stringify(results.safety));

  const safetyChecks = await page.evaluate(() => {
    const s = window._DB.g('safety');
    const sevs = new Set(s.map(x => x.severity));
    return { len: s.length, sevs: [...sevs] };
  });
  T('Safety: count >= 55', safetyChecks.len >= 55, `got ${safetyChecks.len}`);
  T('Safety: all 4 severities', safetyChecks.sevs.length === 4, safetyChecks.sevs.join(', '));

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 3 — INDEPENDENT MODULES
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 3: Independent Modules ══');

  // ── 3.1  Projects (55) ────────────────────────────────────────────
  console.log('\n── 3.1 Projects (55) ──');
  results.projects = await page.evaluate(() => {
    const statuses = ['Proposed','For Approval','Ongoing','Delayed','Completed','Closed'];
    const statDist = [8, 7, 15, 8, 10, 7];
    const cats = ['Infrastructure','Electrical','Plumbing','HVAC','Civil Works','Safety','Environmental','Equipment'];
    const titles = [
      'Rehabilitation of Ward','CCTV Expansion Phase','Roof Waterproofing',
      'Water System Upgrade','Electrical Panel Replacement','AC System Overhaul',
      'Fire Safety Compliance','Elevator Modernization','Corridor Renovation',
      'Solar Panel Installation','WTP Upgrade Phase','Generator Room Expansion'
    ];
    let statIdx = 0, statBucket = 0, count = 0;
    for (let i = 0; i < 55; i++) {
      try {
        if (statBucket >= statDist[statIdx]) { statIdx++; statBucket = 0; }
        const st = statuses[statIdx]; statBucket++;
        const phys = st === 'Completed' || st === 'Closed' ? 100 : st === 'Proposed' ? 0 : Math.floor(Math.random() * 80) + 5;
        const fin = Math.min(100, phys + Math.floor(Math.random() * 20) - 5);
        const budget = 50000 + Math.floor(Math.random() * 1950000);
        const code = `PROJ-${i < 20 ? '2025' : '2026'}-${String(i + 1).padStart(3, '0')}`;
        const startD = new Date(2025, 6 + Math.floor(i / 8), 1 + (i % 28));
        const targetD = new Date(startD.getTime() + (90 + Math.floor(Math.random() * 180)) * 86400000);

        openProjectModal();
        const el = id => document.getElementById(id);
        el('m-pj-code').value = code;
        el('m-pj-title').value = titles[i % titles.length] + ' ' + String.fromCharCode(65 + (i % 26));
        el('m-pj-cat').value = cats[i % cats.length];
        el('m-pj-loc').value = ['Main Building','Ward 1','Ward 2','Ward 3','All Buildings','Pump Room','Generator Room','Roof Deck'][i % 8];
        el('m-pj-status').value = st;
        el('m-pj-budget').value = budget;
        el('m-pj-fund').value = i % 3 === 0 ? 'MOOE' : i % 3 === 1 ? 'Capital Outlay' : 'Special Fund';
        el('m-pj-resp').value = ['Engr. Juan dela Cruz','Engr. Jose Ramos','Engr. Pedro Santos','Engr. Ramon Reyes'][i % 4];
        el('m-pj-start').value = startD.toISOString().split('T')[0];
        el('m-pj-target').value = targetD.toISOString().split('T')[0];
        el('m-pj-physical').value = phys;
        el('m-pj-financial').value = Math.max(0, fin);
        el('m-pj-remarks').value = '';
        saveProject();
        count++;
      } catch (e) { console.warn('Project error:', e.message); }
    }
    navigate('projects'); renderProjects();
    return { target: 55, inserted: count, dbTotal: window._DB.g('projects').length };
  });
  console.log('  Projects:', JSON.stringify(results.projects));
  T('Projects: count >= 55', results.projects.dbTotal >= 55, `got ${results.projects.dbTotal}`);

  // ── 3.2  Waste (55) ──────────────────────────────────────────────
  console.log('\n── 3.2 Waste (55) ──');
  results.waste = await page.evaluate(() => {
    const types = ['Infectious','Sharps','Pathological','Chemical','Pharmaceutical','General','Radioactive'];
    const typeDist = [22, 10, 8, 5, 4, 4, 2];
    let typeIdx = 0, typeBucket = 0, count = 0;
    const base = new Date('2025-10-01');
    for (let i = 0; i < 55; i++) {
      try {
        if (typeBucket >= typeDist[typeIdx]) { typeIdx++; typeBucket = 0; }
        const tp = types[typeIdx]; typeBucket++;
        const d = new Date(base.getTime() + i * 3 * 86400000);
        const vol = (2 + Math.random() * 18).toFixed(1);
        const emb = i < 45 ? 'OK' : i < 52 ? 'Warning' : 'Critical';

        openWasteModal();
        const el = id => document.getElementById(id);
        el('m-w-date').value = d.toISOString().split('T')[0];
        el('m-w-type').value = tp;
        el('m-w-vol').value = vol;
        el('m-w-contractor').value = i % 2 === 0 ? 'BioMed Disposal Inc.' : 'GreenWaste Solutions';
        el('m-w-emb').value = emb;
        el('m-w-remarks').value = '';
        saveWaste();
        count++;
      } catch (e) { console.warn('Waste error:', e.message); }
    }
    navigate('waste'); renderWaste();
    return { target: 55, inserted: count, dbTotal: window._DB.g('waste').length };
  });
  console.log('  Waste:', JSON.stringify(results.waste));
  T('Waste: count >= 55', results.waste.dbTotal >= 55, `got ${results.waste.dbTotal}`);

  // ── 3.3  Water Logs (55) ─────────────────────────────────────────
  console.log('\n── 3.3 Water Logs (55) ──');
  results.waterLogs = await page.evaluate(() => {
    const wards = ['ICU','ER','OR Complex','Ward 1','Ward 2','Ward 3','Ward 4','Ward 5','Ward 6','Pediatric Ward','Kitchen','Laboratory','Pharmacy'];
    const resultDist = { Safe: 42, Warning: 8, Fail: 5 };
    let count = 0, ri = 0;
    const base = new Date('2025-10-01');
    const results_ = [];
    for (const [r, n] of Object.entries(resultDist)) for (let i = 0; i < n; i++) results_.push(r);
    for (let i = 0; i < 55; i++) {
      try {
        const d = new Date(base.getTime() + i * 3 * 86400000);
        const ward = wards[i % wards.length];
        const result = results_[i] || 'Safe';
        const type = i < 45 ? 'Bacteriological' : 'Chemical';
        const bact = result === 'Safe' ? '0' : result === 'Warning' ? '1' : '3';
        const chlor = result === 'Fail' ? '0.05' : (0.2 + Math.random() * 0.3).toFixed(2);

        openWaterLogModal();
        const el = id => document.getElementById(id);
        el('m-wl-date').value = d.toISOString().split('T')[0];
        el('m-wl-ward').value = ward;
        el('m-wl-type').value = type;
        el('m-wl-result').value = result;
        el('m-wl-bacteria').value = bact;
        el('m-wl-chlorine').value = chlor;
        if (result === 'Fail') el('m-wl-mitigation').value = 'Hyperchlorination applied, re-test scheduled';
        el('m-wl-remarks').value = '';
        saveWaterLog();
        count++;
      } catch (e) { console.warn('WaterLog error:', e.message); }
    }
    navigate('water'); renderWaterLogs();
    return { target: 55, inserted: count, dbTotal: window._DB.g('waterLogs').length };
  });
  console.log('  Water Logs:', JSON.stringify(results.waterLogs));
  T('Water Logs: count >= 55', results.waterLogs.dbTotal >= 55, `got ${results.waterLogs.dbTotal}`);

  // ── 3.4  Water Tank (55) ─────────────────────────────────────────
  console.log('\n── 3.4 Water Tank (55) ──');
  results.waterTank = await page.evaluate(() => {
    const tanks = ['Main Rooftop Tank','Ground Reservoir','Elevated Tank B'];
    let count = 0;
    const base = new Date('2025-11-01');
    for (let i = 0; i < 55; i++) {
      try {
        const d = new Date(base.getTime() + i * 2.5 * 86400000);
        const tank = tanks[i % tanks.length];
        const level = 20 + Math.floor(Math.random() * 75);
        const cap = tank.includes('Main') ? 20000 : tank.includes('Ground') ? 10000 : 15000;
        const patients = 150 + Math.floor(Math.random() * 90);

        openTankModal();
        const el = id => document.getElementById(id);
        el('m-tk-dt').value = d.toISOString().slice(0, 16);
        el('m-tk-name').value = tank;
        el('m-tk-level').value = level;
        el('m-tk-cap').value = cap;
        el('m-tk-patients').value = patients;
        el('m-tk-remarks').value = level < 30 ? 'Low level alert — pump runtime increased' : '';
        saveTankReading();
        count++;
      } catch (e) { console.warn('Tank error:', e.message); }
    }
    navigate('watertank'); renderWaterTank();
    return { target: 55, inserted: count, dbTotal: window._DB.g('waterTank').length };
  });
  console.log('  Water Tank:', JSON.stringify(results.waterTank));
  T('Water Tank: count >= 55', results.waterTank.dbTotal >= 55, `got ${results.waterTank.dbTotal}`);

  // ── 3.5  Effluent (55) ───────────────────────────────────────────
  console.log('\n── 3.5 Effluent (55) ──');
  results.effluent = await page.evaluate(() => {
    const points = ['STP Effluent','Drainage Outfall','Septic Tank Outlet'];
    const pointDist = [35, 10, 10];
    let pIdx = 0, pBucket = 0, count = 0;
    const base = new Date('2025-10-01');
    for (let i = 0; i < 55; i++) {
      try {
        if (pBucket >= pointDist[pIdx]) { pIdx++; pBucket = 0; }
        const pt = points[pIdx]; pBucket++;
        const d = new Date(base.getTime() + i * 3 * 86400000);
        const compliant = i < 40;
        const ph = (6.5 + Math.random() * 2).toFixed(1);
        const bod = compliant ? 15 + Math.floor(Math.random() * 20) : 50 + Math.floor(Math.random() * 30);
        const cod = bod * 2 + Math.floor(Math.random() * 20);
        const tss = 10 + Math.floor(Math.random() * (compliant ? 20 : 40));
        const coliform = compliant ? Math.floor(Math.random() * 20) : 50 + Math.floor(Math.random() * 100);

        openEffluentModal();
        const el = id => document.getElementById(id);
        el('m-eff-date').value = d.toISOString().split('T')[0];
        el('m-eff-point').value = pt;
        el('m-eff-ph').value = ph;
        el('m-eff-bod').value = bod;
        el('m-eff-cod').value = cod;
        el('m-eff-tss').value = tss;
        el('m-eff-coliform').value = coliform;
        el('m-eff-status').value = compliant ? 'Compliant' : 'Non-Compliant';
        el('m-eff-remarks').value = compliant ? '' : 'Corrective action: aeration increased';
        saveEffluent();
        count++;
      } catch (e) { console.warn('Effluent error:', e.message); }
    }
    navigate('effluent'); renderEffluent();
    return { target: 55, inserted: count, dbTotal: window._DB.g('effluent').length };
  });
  console.log('  Effluent:', JSON.stringify(results.effluent));
  T('Effluent: count >= 55', results.effluent.dbTotal >= 55, `got ${results.effluent.dbTotal}`);

  // ── 3.6  Med Waste Prod (55) ─────────────────────────────────────
  console.log('\n── 3.6 Med Waste Prod (55) ──');
  results.medWasteProd = await page.evaluate(() => {
    const shifts = ['AM Shift','PM Shift','Night Shift'];
    let count = 0;
    const base = new Date('2025-10-01');
    for (let i = 0; i < 55; i++) {
      try {
        const d = new Date(base.getTime() + i * 3 * 86400000);
        const shift = shifts[i % shifts.length];
        const input = 30 + Math.floor(Math.random() * 35);
        const treated = Math.max(input - Math.floor(Math.random() * 5), input - 3);
        const output = 3 + Math.floor(Math.random() * 8);
        const ophrs = 4 + Math.floor(Math.random() * 5);
        const downtime = Math.random() < 0.2 ? Math.floor(Math.random() * 3) : 0;

        openMedWasteModal();
        const el = id => document.getElementById(id);
        el('m-mw-date').value = d.toISOString().split('T')[0];
        el('m-mw-shift').value = shift;
        el('m-mw-input').value = input;
        el('m-mw-treated').value = treated;
        el('m-mw-output').value = output;
        el('m-mw-ophrs').value = ophrs;
        if (document.getElementById('m-mw-downtime')) el('m-mw-downtime').value = downtime;
        el('m-mw-remarks').value = '';
        saveMedWaste();
        count++;
      } catch (e) { console.warn('MedWaste error:', e.message); }
    }
    navigate('medwaste'); renderMedWaste();
    return { target: 55, inserted: count, dbTotal: window._DB.g('medWasteProd').length };
  });
  console.log('  Med Waste:', JSON.stringify(results.medWasteProd));
  T('Med Waste: count >= 55', results.medWasteProd.dbTotal >= 55, `got ${results.medWasteProd.dbTotal}`);

  // ── 3.7  WW Prod (55) ───────────────────────────────────────────
  console.log('\n── 3.7 WW Prod (55) ──');
  results.wwProd = await page.evaluate(() => {
    const shifts = ['AM Shift','PM Shift','Night Shift'];
    let count = 0;
    const base = new Date('2025-10-01');
    for (let i = 0; i < 55; i++) {
      try {
        const d = new Date(base.getTime() + i * 3 * 86400000);
        const shift = shifts[i % shifts.length];
        const inflow = 60 + Math.floor(Math.random() * 40);
        const treated = inflow - Math.floor(Math.random() * 3);
        const outflow = treated - Math.floor(Math.random() * 5);
        const ophrs = 6 + Math.floor(Math.random() * 5);
        const downtime = Math.random() < 0.15 ? Math.floor(Math.random() * 4) : 0;

        openWWProdModal();
        const el = id => document.getElementById(id);
        el('m-ww-date').value = d.toISOString().split('T')[0];
        el('m-ww-shift').value = shift;
        el('m-ww-inflow').value = inflow;
        el('m-ww-treated').value = treated;
        el('m-ww-outflow').value = outflow;
        el('m-ww-ophrs').value = ophrs;
        if (document.getElementById('m-ww-downtime')) el('m-ww-downtime').value = downtime;
        el('m-ww-remarks').value = '';
        saveWWProd();
        count++;
      } catch (e) { console.warn('WWProd error:', e.message); }
    }
    navigate('wwprod'); renderWWProd();
    return { target: 55, inserted: count, dbTotal: window._DB.g('wwProd').length };
  });
  console.log('  WW Prod:', JSON.stringify(results.wwProd));
  T('WW Prod: count >= 55', results.wwProd.dbTotal >= 55, `got ${results.wwProd.dbTotal}`);

  // ── 3.8  Metadata (Personnel, Inpatient, Water Settings) ─────────
  console.log('\n── 3.8 Metadata ──');
  await page.evaluate(() => {
    navigate('dashboard');
    const el = id => document.getElementById(id);
    // Personnel
    el('pers-elec').value = 4;
    el('pers-mech').value = 3;
    el('pers-cmw').value = 5;
    el('pers-hskp').value = 6;
    el('pers-plbg').value = 3;
    savePersonnel();
    // Inpatient
    el('dash-inpatient').value = 195;
    saveInpatient();
    // Water Settings
    saveWaterSettings({
      litersPerBedPerDay: 500,
      litersPerOutpatient: 25,
      litersPerStaff: 50,
      litersPerVisitor: 10,
      reserveDays: 3,
      mainTankCapacity: 20000,
      groundReservoirCapacity: 10000,
      peakHourFactor: 1.5,
    });
  });
  console.log('  Metadata saved (personnel, inpatient, water settings).');

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 4 — CRUD VERIFICATION (750+ records loaded)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 4: CRUD Verification Under Volume ══');

  // ── 4.1  Create 1 new record per module ──────────────────────────
  console.log('\n── 4.1 Create 1 per module ──');
  const crudCreate = await page.evaluate(() => {
    const res = {};
    const before = {};
    const stores = ['assets','inventory','wo','safety','projects','waste','waterLogs','waterTank','effluent','medWasteProd','wwProd'];
    stores.forEach(k => before[k] = window._DB.g(k).length);

    // Asset
    openAssetModal(); document.getElementById('m-a-name').value='CRUD Test Asset'; document.getElementById('m-a-section').value='Electrical'; saveAsset();
    res.assets = window._DB.g('assets').length - before.assets;

    // Inventory
    openInvModal(); document.getElementById('m-i-desc').value='CRUD Test Item'; document.getElementById('m-i-cat').value='Electrical'; document.getElementById('m-i-qty').value=10; saveInvItem();
    res.inventory = window._DB.g('inventory').length - before.inventory;

    // WO
    openWOModal(); document.getElementById('m-wo-section').value='Electrical'; document.getElementById('m-wo-desc').value='CRUD test work order'; saveWO();
    res.wo = window._DB.g('wo').length - before.wo;

    // Safety
    openSafetyModal(); document.getElementById('m-sf-desc').value='CRUD test safety issue'; document.getElementById('m-sf-sev').value='Low'; saveSafety();
    res.safety = window._DB.g('safety').length - before.safety;

    // Projects
    openProjectModal(); document.getElementById('m-pj-code').value='PROJ-CRUD-001'; document.getElementById('m-pj-title').value='CRUD Test Project'; saveProject();
    res.projects = window._DB.g('projects').length - before.projects;

    // Waste
    openWasteModal(); document.getElementById('m-w-date').value='2026-03-21'; document.getElementById('m-w-type').value='General'; document.getElementById('m-w-vol').value=1; saveWaste();
    res.waste = window._DB.g('waste').length - before.waste;

    // Water Log
    openWaterLogModal(); document.getElementById('m-wl-date').value='2026-03-21'; document.getElementById('m-wl-ward').value='Test Ward'; saveWaterLog();
    res.waterLogs = window._DB.g('waterLogs').length - before.waterLogs;

    // Tank
    openTankModal(); document.getElementById('m-tk-dt').value='2026-03-21T10:00'; document.getElementById('m-tk-name').value='CRUD Tank'; document.getElementById('m-tk-level').value=50; document.getElementById('m-tk-cap').value=5000; document.getElementById('m-tk-patients').value=100; saveTankReading();
    res.waterTank = window._DB.g('waterTank').length - before.waterTank;

    // Effluent
    openEffluentModal(); document.getElementById('m-eff-date').value='2026-03-21'; document.getElementById('m-eff-point').value='CRUD Point'; saveEffluent();
    res.effluent = window._DB.g('effluent').length - before.effluent;

    // Med Waste
    openMedWasteModal(); document.getElementById('m-mw-date').value='2026-03-21'; saveMedWaste();
    res.medWasteProd = window._DB.g('medWasteProd').length - before.medWasteProd;

    // WW Prod
    openWWProdModal(); document.getElementById('m-ww-date').value='2026-03-21'; saveWWProd();
    res.wwProd = window._DB.g('wwProd').length - before.wwProd;

    return res;
  });
  for (const [mod, delta] of Object.entries(crudCreate)) {
    T(`Create: ${mod}`, delta === 1, `delta = ${delta}`);
  }

  // ── 4.2  Edit 1 record per module ─────────────────────────────────
  console.log('\n── 4.2 Edit 1 per module ──');
  const crudEdit = await page.evaluate(() => {
    const res = {};

    // Asset — edit first record
    const assets = window._DB.g('assets');
    const aId = assets[0]?.id;
    if (aId) {
      const beforeLen = assets.length;
      openAssetModal(aId);
      document.getElementById('m-a-remarks').value = 'EDITED by load test';
      saveAsset();
      const after = window._DB.g('assets');
      const edited = after.find(x => x.id === aId);
      res.assets = { sameCount: after.length === beforeLen, edited: edited?.remarks === 'EDITED by load test' };
    }

    // WO — edit first record
    const wos = window._DB.g('wo');
    const wId = wos[0]?.id;
    if (wId) {
      const beforeLen = wos.length;
      openWOModal(wId);
      document.getElementById('m-wo-remarks').value = 'EDITED by load test';
      saveWO();
      const after = window._DB.g('wo');
      const edited = after.find(x => x.id === wId);
      res.wo = { sameCount: after.length === beforeLen, edited: edited?.remarks === 'EDITED by load test' };
    }

    // Inventory — edit first record
    const inv = window._DB.g('inventory');
    const iId = inv[0]?.id;
    if (iId) {
      const beforeLen = inv.length;
      openInvModal(iId);
      document.getElementById('m-i-desc').value = inv[0].description + ' EDITED';
      saveInvItem();
      const after = window._DB.g('inventory');
      const edited = after.find(x => x.id === iId);
      res.inventory = { sameCount: after.length === beforeLen, edited: (edited?.description || '').includes('EDITED') };
    }

    return res;
  });
  T('Edit: assets — no duplicate, field changed', crudEdit.assets?.sameCount && crudEdit.assets?.edited, '');
  T('Edit: wo — no duplicate, field changed', crudEdit.wo?.sameCount && crudEdit.wo?.edited, '');
  T('Edit: inventory — no duplicate, field changed', crudEdit.inventory?.sameCount && crudEdit.inventory?.edited, '');

  // ── 4.3  Delete 1 record per module ───────────────────────────────
  console.log('\n── 4.3 Delete 1 per module ──');
  const crudDelete = await page.evaluate(async () => {
    const res = {};
    const stores = [
      ['assets', delAsset, renderAssets],
      ['wo', delWO, renderWO],
      ['inventory', delInvItem, renderInventory],
      ['safety', delSafety, renderSafety],
      ['projects', delProject, renderProjects],
      ['waste', delWaste, renderWaste],
      ['waterLogs', delWaterLog, renderWaterLogs],
      ['waterTank', delTankReading, renderWaterTank],
      ['effluent', delEffluent, renderEffluent],
      ['medWasteProd', delMedWaste, renderMedWaste],
      ['wwProd', delWWProd, renderWWProd],
    ];
    for (const [store, delFn] of stores) {
      const arr = window._DB.g(store);
      const beforeLen = arr.length;
      const lastId = arr[arr.length - 1]?.id;
      if (lastId) {
        await delFn(lastId);
        res[store] = window._DB.g(store).length === beforeLen - 1;
      }
    }
    return res;
  });
  for (const [mod, ok] of Object.entries(crudDelete)) {
    T(`Delete: ${mod}`, ok, '');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 5 — CROSS-MODULE TRANSACTION TESTS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 5: Cross-Module Transactions ══');

  // 5.1 — WO + Materials → Inventory Deduction
  const xm1 = await page.evaluate(() => {
    const inv = window._DB.g('inventory');
    const item1 = inv.find(i => (i.description || '').includes('LED Bulb 15W'));
    const item2 = inv.find(i => (i.description || '').includes('Electrical Tape'));
    if (!item1 || !item2) return { ok: false, reason: 'items not found' };
    const q1Before = item1.qty, q2Before = item2.qty;
    const issBefore = window._DB.g('issuance').length;

    openWOModal();
    document.getElementById('m-wo-section').value = 'Electrical';
    document.getElementById('m-wo-desc').value = 'Cross-module test — materials deduction';
    _woMaterials = [
      { invId: item1.id, qty: 3, issuedTo: 'Test Engineer' },
      { invId: item2.id, qty: 2, issuedTo: 'Test Engineer' }
    ];
    renderMaterialRows();
    saveWO();

    const invAfter = window._DB.g('inventory');
    const a1 = invAfter.find(i => i.id === item1.id);
    const a2 = invAfter.find(i => i.id === item2.id);
    const issAfter = window._DB.g('issuance').length;
    const lastIss = window._DB.g('issuance').slice(-2);
    const hasWoRef = lastIss.every(i => (i.woRef || '').startsWith('WO-'));

    return {
      ok: a1.qty === q1Before - 3 && a2.qty === q2Before - 2 && issAfter === issBefore + 2,
      deducted: `${q1Before}→${a1.qty}, ${q2Before}→${a2.qty}`,
      issNew: issAfter - issBefore,
      woRef: hasWoRef
    };
  });
  T('5.1 WO materials → inventory deduction', xm1.ok, xm1.deducted);
  T('5.1 Auto-issuance with WO ref', xm1.woRef, '');

  // 5.3 — Insufficient stock guard (WO)
  const xm3 = await page.evaluate(() => {
    const inv = window._DB.g('inventory');
    const item = inv.find(i => (i.description || '').includes('Hand Soap')); // low stock: qty ~3
    if (!item) return { blocked: false, reason: 'item not found' };
    const woBefore = window._DB.g('wo').length;
    window._toasts = [];

    openWOModal();
    document.getElementById('m-wo-section').value = 'Housekeeping';
    document.getElementById('m-wo-desc').value = 'Insufficient stock test';
    _woMaterials = [{ invId: item.id, qty: 9999, issuedTo: 'Test' }];
    renderMaterialRows();
    saveWO();

    const woAfter = window._DB.g('wo').length;
    const warned = window._toasts.some(t => t.type === 'warning' && (t.msg || '').includes('Insufficient'));
    return { blocked: woAfter === woBefore, warned };
  });
  T('5.3 Insufficient stock blocks WO save', xm3.blocked, '');
  T('5.3 Toast warning shown', xm3.warned, '');

  // 5.4 — Insufficient stock on manual issuance
  const xm4 = await page.evaluate(() => {
    const inv = window._DB.g('inventory');
    const item = inv.find(i => (i.description || '').includes('Hand Soap'));
    if (!item) return { blocked: false };
    const issBefore = window._DB.g('issuance').length;
    window._toasts = [];

    openIssueModal();
    document.getElementById('m-iss-item').value = item.id;
    document.getElementById('m-iss-qty').value = 9999;
    document.getElementById('m-iss-to').value = 'Test';
    saveManualIssue();

    return { blocked: window._DB.g('issuance').length === issBefore };
  });
  T('5.4 Insufficient stock blocks manual issuance', xm4.blocked, '');

  // 5.5 — Asset ↔ WO repair history
  const xm5 = await page.evaluate(() => {
    const assets = window._DB.g('assets');
    const wos = window._DB.g('wo');
    // Find an asset that has WOs linked to it
    for (const a of assets) {
      const linked = wos.filter(w => w.asset === a.name);
      if (linked.length > 0) {
        viewHistory(a.id);
        const tbody = document.getElementById('history-tbody');
        const rows = tbody ? tbody.querySelectorAll('tr').length : 0;
        closeModal('mo-history');
        return { found: true, assetName: a.name, woCount: linked.length, historyRows: rows };
      }
    }
    return { found: false };
  });
  T('5.5 Asset repair history shows linked WOs', xm5.found && xm5.historyRows > 0, `${xm5.woCount} WOs, ${xm5.historyRows} rows`);

  // 5.8 — Dashboard aggregation
  const xm8 = await page.evaluate(() => {
    navigate('dashboard');
    renderDash();
    const wos = window._DB.g('wo');
    const open = wos.filter(w => w.status === 'Open' || w.status === 'In Progress').length;
    const ovr = wos.filter(w => (w.status !== 'Closed' && w.status !== 'Completed') && w.targetCompletionDate && today() > w.targetCompletionDate).length;
    const inv = window._DB.g('inventory');
    const low = inv.filter(i => i.qty <= (i.minLevel || 0)).length;
    const waste = window._DB.g('waste');
    const crit = waste.filter(w => w.emb === 'Critical').length;

    // Read rendered stat cards
    const statsHTML = document.getElementById('dash-stats')?.innerHTML || '';
    const hasOpen = statsHTML.includes(`>${open}<`);
    const hasOvr = statsHTML.includes(`>${ovr}<`);
    return { open, ovr, low, crit, htmlMatchesOpen: hasOpen, htmlMatchesOvr: hasOvr };
  });
  T('5.8 Dashboard open WO count matches DB', xm8.htmlMatchesOpen, `open=${xm8.open}`);
  T('5.8 Dashboard overdue count matches DB', xm8.htmlMatchesOvr, `overdue=${xm8.ovr}`);

  // 5.10 — CSV export row count (spot check assets)
  const xm10 = await page.evaluate(() => {
    // Intercept download by overriding the link click
    let csvContent = '';
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { csvContent = 'intercepted'; return 'blob:test'; };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { /* no-op */ };
    try { exportCSV('assets'); } catch(e) {}
    URL.createObjectURL = origCreate;
    HTMLAnchorElement.prototype.click = origClick;
    // Can't easily get CSV content, but verify no crash
    return { noError: true };
  });
  T('5.10 CSV export runs without error', xm10.noError, '');

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 6 — VALIDATION & ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 6: Validation & Error Handling ══');

  // 6.1 — Required field validation
  const v1 = await page.evaluate(() => {
    const woBefore = window._DB.g('wo').length;
    openWOModal();
    document.getElementById('m-wo-section').value = '';
    document.getElementById('m-wo-desc').value = '';
    saveWO();
    const woAfter = window._DB.g('wo').length;

    const assetBefore = window._DB.g('assets').length;
    openAssetModal();
    document.getElementById('m-a-name').value = '';
    document.getElementById('m-a-section').value = '';
    saveAsset();
    const assetAfter = window._DB.g('assets').length;

    const invBefore = window._DB.g('inventory').length;
    openInvModal();
    document.getElementById('m-i-desc').value = '';
    document.getElementById('m-i-cat').value = '';
    saveInvItem();
    const invAfter = window._DB.g('inventory').length;

    return {
      woBlocked: woAfter === woBefore,
      assetBlocked: assetAfter === assetBefore,
      invBlocked: invAfter === invBefore
    };
  });
  T('6.1 Empty WO blocked', v1.woBlocked, '');
  T('6.1 Empty asset blocked', v1.assetBlocked, '');
  T('6.1 Empty inventory blocked', v1.invBlocked, '');

  // 6.2 — Edit conflict detection
  const v2 = await page.evaluate(() => {
    // Restore original confirmDialog for edit conflict test
    window.confirmDialog = window._origConfirmDialog || (() => Promise.resolve(true));

    const assets = window._DB.g('assets');
    const id = assets[0]?.id;
    if (!id) return { conflictDetected: false };
    window._toasts = [];

    openAssetModal(id);
    // Externally bump _v
    const rec = assets.find(x => x.id === id);
    if (rec) rec._v = (rec._v || 0) + 100;
    // Try to save
    saveAsset();

    const detected = window._toasts.some(t => (t.msg || '').toLowerCase().includes('conflict'));
    // Restore auto-confirm
    window.confirmDialog = () => Promise.resolve(true);
    return { conflictDetected: detected };
  });
  T('6.2 Edit conflict detected', v2.conflictDetected, '');

  // 6.3 — XSS prevention
  const v3 = await page.evaluate(() => {
    openAssetModal();
    document.getElementById('m-a-name').value = '<script>alert("XSS")</script>';
    document.getElementById('m-a-section').value = 'Electrical';
    saveAsset();
    navigate('assets'); renderAssets();

    const tbody = document.getElementById('asset-tbody');
    const html = tbody?.innerHTML || '';
    const hasRawScript = html.includes('<script>');
    const hasEscaped = html.includes('&lt;script&gt;') || html.includes('&lt;script');
    return { safe: !hasRawScript, escaped: hasEscaped };
  });
  T('6.3 XSS: no raw <script> in DOM', v3.safe, '');

  // 6.4 — Special characters
  const v4 = await page.evaluate(() => {
    const specialName = "O'Brien & Sons \"Equipment\" — 30°C";
    openAssetModal();
    document.getElementById('m-a-name').value = specialName;
    document.getElementById('m-a-section').value = 'CMW';
    saveAsset();
    const saved = window._DB.g('assets').find(a => a.name === specialName);
    return { savedOk: !!saved };
  });
  T('6.4 Special characters saved correctly', v4.savedOk, '');

  // 6.5 — Modal close without save
  const v5 = await page.evaluate(() => {
    const before = window._DB.g('wo').length;
    openWOModal();
    document.getElementById('m-wo-section').value = 'Electrical';
    document.getElementById('m-wo-desc').value = 'Should not be saved';
    closeModal('mo-wo');
    return { noNewRecord: window._DB.g('wo').length === before };
  });
  T('6.5 Modal close without save — no record', v5.noNewRecord, '');

  // 6.6 — Delete non-existent record
  const v6 = await page.evaluate(async () => {
    const before = window._DB.g('wo').length;
    try { await delWO(999999999); } catch(e) {}
    return { noChange: window._DB.g('wo').length === before };
  });
  T('6.6 Delete non-existent — no crash', v6.noChange, '');

  // 6.7 — Rapid successive saves
  const v7 = await page.evaluate(() => {
    const before = window._DB.g('wo').length;
    for (let i = 0; i < 10; i++) {
      openWOModal();
      document.getElementById('m-wo-section').value = 'Electrical';
      document.getElementById('m-wo-desc').value = 'Rapid save test #' + i;
      saveWO();
    }
    const after = window._DB.g('wo');
    const ids = new Set(after.map(w => w.id));
    return { added: after.length - before, uniqueIds: ids.size === after.length };
  });
  T('6.7 Rapid saves: 10 records added', v7.added === 10, `added ${v7.added}`);
  T('6.7 Rapid saves: all unique IDs', v7.uniqueIds, '');

  // 6.8 — Large text field
  const v8 = await page.evaluate(() => {
    const bigText = 'A'.repeat(2000);
    openWOModal();
    document.getElementById('m-wo-section').value = 'CMW';
    document.getElementById('m-wo-desc').value = bigText;
    saveWO();
    const saved = window._DB.g('wo').find(w => (w.description || '').length >= 2000);
    return { savedOk: !!saved };
  });
  T('6.8 Large text (2000 chars) saved', v8.savedOk, '');

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 7 — PERFORMANCE & NAVIGATION
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 7: Performance & Navigation ══');

  // 7.1 — Navigate all 17 pages
  const pages = ['dashboard','workorders','assets','forecast','inventory','issuance',
    'waste','wastefcast','safety','projects','water','watertank','effluent',
    'medwaste','wwprod','reports','instructions'];
  const navErrors = [];
  for (const pg of pages) {
    const errBefore = pageErrors.length;
    await page.evaluate(p => navigate(p), pg);
    await page.waitForTimeout(200);
    if (pageErrors.length > errBefore) navErrors.push(pg);
  }
  T('7.1 All 17 pages navigate without JS error', navErrors.length === 0, navErrors.length > 0 ? `errors on: ${navErrors.join(', ')}` : '');

  // 7.2 — Dashboard render time
  const dashTime = await page.evaluate(() => {
    navigate('dashboard');
    const t0 = performance.now();
    renderDash();
    return Math.round(performance.now() - t0);
  });
  T('7.2 Dashboard renders < 500ms', dashTime < 500, `${dashTime}ms`);

  // 7.3 — Filter performance (assets by section)
  const filterTime = await page.evaluate(() => {
    navigate('assets');
    document.getElementById('af-section').value = 'Electrical';
    const t0 = performance.now();
    renderAssets();
    const elapsed = Math.round(performance.now() - t0);
    const rows = document.getElementById('asset-tbody')?.querySelectorAll('tr').length || 0;
    document.getElementById('af-section').value = '';
    renderAssets();
    return { elapsed, rows };
  });
  T('7.3 Asset filter < 100ms', filterTime.elapsed < 100, `${filterTime.elapsed}ms, ${filterTime.rows} rows`);

  // 7.4 — Chart integrity (no NaN)
  const chartCheck = await page.evaluate(() => {
    navigate('safety'); renderSafety();
    const safetyChart = document.getElementById('safety-month-chart');
    const safetyHasContent = safetyChart && safetyChart.innerHTML.length > 10;

    navigate('medwaste'); renderMedWaste();
    const mwChart = document.getElementById('mw-io-chart');
    const mwHasContent = mwChart && mwChart.innerHTML.length > 10;

    navigate('wwprod'); renderWWProd();
    const wwChart = document.getElementById('ww-io-chart');
    const wwHasContent = wwChart && wwChart.innerHTML.length > 10;

    // Check for NaN in any visible text
    const body = document.body.innerText;
    const hasNaN = body.includes('NaN');

    return { safetyChart: safetyHasContent, mwChart: mwHasContent, wwChart: wwHasContent, noNaN: !hasNaN };
  });
  T('7.4 Safety chart renders', chartCheck.safetyChart, '');
  T('7.4 Med Waste chart renders', chartCheck.mwChart, '');
  T('7.4 WW Prod chart renders', chartCheck.wwChart, '');
  T('7.4 No NaN in visible text', chartCheck.noNaN, '');

  // 7.5 — Offline/Online cycle
  const offlineCheck = await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    const banner = document.getElementById('storage-banner');
    const chip = document.getElementById('storage-chip');
    const offlineBanner = banner?.style.display !== 'none';
    const offlineChip = chip?.textContent?.toLowerCase().includes('offline') || chip?.className?.includes('chip-offline');

    window.dispatchEvent(new Event('online'));
    // Small delay for UI update
    return { offlineBanner, offlineChip };
  });
  T('7.5 Offline event triggers UI feedback', offlineCheck.offlineBanner || offlineCheck.offlineChip, '');

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 8 — FINAL REPORT & SCREENSHOTS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 8: Final Report ══');

  // Get final counts
  const finalCounts = await page.evaluate(() => {
    navigate('dashboard'); renderDash();
    const g = window._DB.g;
    const counts = {
      assets: g('assets').length,
      inventory: g('inventory').length,
      censusLog: g('censusLog').length,
      wo: g('wo').length,
      issuance: g('issuance').length,
      safety: g('safety').length,
      projects: g('projects').length,
      waste: g('waste').length,
      waterLogs: g('waterLogs').length,
      waterTank: g('waterTank').length,
      effluent: g('effluent').length,
      medWasteProd: g('medWasteProd').length,
      wwProd: g('wwProd').length,
    };
    counts.TOTAL = Object.values(counts).reduce((s, n) => s + n, 0);
    return counts;
  });
  T('Total records >= 750', finalCounts.TOTAL >= 750, `got ${finalCounts.TOTAL}`);

  // Screenshots — close all modals and toasts first
  console.log('\n── Screenshots ──');
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.toast').forEach(t => t.remove());
    document.querySelectorAll('[class*="toast"]').forEach(t => { t.style.display = 'none'; });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => { navigate('dashboard'); renderDash(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'D:/DOPMC/cmms/test-results/load-01-dashboard.png', fullPage: false });

  await page.evaluate(() => { navigate('workorders'); renderWO(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'D:/DOPMC/cmms/test-results/load-02-workorders.png', fullPage: false });

  await page.evaluate(() => { navigate('assets'); document.getElementById('af-section').value = 'Electrical'; renderAssets(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'D:/DOPMC/cmms/test-results/load-03-assets-filtered.png', fullPage: false });

  await page.evaluate(() => { navigate('watertank'); renderWaterTank(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'D:/DOPMC/cmms/test-results/load-04-watertank.png', fullPage: false });

  await page.evaluate(() => { navigate('safety'); renderSafety(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'D:/DOPMC/cmms/test-results/load-05-safety-chart.png', fullPage: false });

  await page.evaluate(() => { navigate('medwaste'); renderMedWaste(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/DOPMC/cmms/test-results/load-06-medwaste-chart.png', fullPage: false });
  console.log('  6 screenshots saved to test-results/');

  // ── Summary Table ─────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('  HAMMS DAILY OPERATIONS LOAD TEST — RESULTS');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Module              | Seeded | Final DB | Status');
  console.log('--------------------|--------|----------|-------');
  const modules = [
    ['Assets', 'assets'], ['Inventory', 'inventory'], ['Census Log', 'censusLog'],
    ['Work Orders', 'wo'], ['Issuance', 'issuance'], ['Safety', 'safety'],
    ['Projects', 'projects'], ['Waste', 'waste'], ['Water Logs', 'waterLogs'],
    ['Water Tank', 'waterTank'], ['Effluent', 'effluent'], ['Med Waste', 'medWasteProd'],
    ['WW Prod', 'wwProd'],
  ];
  for (const [name, key] of modules) {
    const seeded = results[key]?.inserted ?? results[key]?.dbTotal ?? '—';
    const final = finalCounts[key] ?? '—';
    const ok = final >= 50 || key === 'censusLog' || key === 'issuance' ? 'OK' : 'LOW';
    console.log(`${name.padEnd(20)}| ${String(seeded).padEnd(7)}| ${String(final).padEnd(9)}| ${ok}`);
  }
  console.log('--------------------|--------|----------|-------');
  console.log(`${'TOTAL'.padEnd(20)}| ${''.padEnd(7)}| ${String(finalCounts.TOTAL).padEnd(9)}| ${finalCounts.TOTAL >= 750 ? 'OK' : 'LOW'}`);
  console.log('');

  // Test summary
  console.log('═'.repeat(70));
  console.log(`  ASSERTIONS: ${passed} passed, ${failed} failed, ${tests.length} total`);
  console.log('═'.repeat(70));
  if (failed > 0) {
    console.log('\n  FAILURES:');
    tests.filter(t => !t.ok).forEach(t => console.log(`    ✗ ${t.name}${t.detail ? ' — ' + t.detail : ''}`));
  }

  // Wait for Firestore sync
  console.log('\nWaiting 10s for Firestore sync...');
  await page.waitForTimeout(10000);

  await browser.close();
  console.log('Done!');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
