import {test,expect} from '@playwright/test';
import {bootstrapApp} from './helpers/bootstrap.mjs';
test.beforeEach(async({page})=>{
 await bootstrapApp(page);
 await page.evaluate(()=>applyStoreData('assets',[
  {id:1,_docId:'rsa-tube',assetCode:'OT-ELEC-DIETAR-09',name:'FLOURESCENT TUBE 18W',section:'Electrical',location:'DIETARY RSA'},
  {id:2,_docId:'rsa-bulb',assetCode:'OT-ELEC-DIETAR-10',name:'COMPACT BULB 15W',section:'Electrical',location:'DIETARY RSA '},
  {id:3,_docId:'other-bulb',assetCode:'OTHER-01',name:'COMPACT BULB 15W',section:'Electrical',location:'Another room'},
  {id:4,_docId:'dietary-general',assetCode:'GENERAL-01',name:'Plumbing fixtures',section:'Plumbing',location:'Dietary'},
  {id:5,_docId:'dietary-cooking',assetCode:'COOKING-01',name:'Cooking light',section:'Electrical',location:'DIETARY COOKING AREA'}
 ]));
});

test('room lists both RSA assets without inventing repairs, and asset action saves correct ownership',async({page})=>{
 await page.evaluate(()=>openRoomView('DIETARY RSA'));
 const rows=page.locator('#room-view-assets tr');await expect(rows).toHaveCount(2);
 await expect(rows.nth(0)).toContainText('No recorded repairs');await expect(rows.nth(1)).toContainText('No recorded repairs');
 await expect(page.locator('#room-view-wos')).toContainText('No recorded repairs for this room');
 await rows.nth(1).getByRole('button',{name:'Create work order'}).click();
 expect(await page.locator('#m-wo-asset').evaluate(el=>el.selectedOptions[0].dataset.docId)).toBe('rsa-bulb');
 await page.locator('#m-wo-desc').fill('Replace damaged RSA bulb');await page.evaluate(()=>saveWO());
 const saved=await page.evaluate(()=>DB.g('wo')[0]);expect(saved.assetDocId).toBe('rsa-bulb');expect(saved.workScope).toBe('asset');
 await page.evaluate(()=>{viewHistory(2);});await expect(page.locator('#history-tbody')).toContainText('Replace damaged RSA bulb');
 await page.evaluate(()=>{closeModal('mo-history');viewHistory(1);});await expect(page.locator('#history-tbody')).not.toContainText('Replace damaged RSA bulb');
 await page.evaluate(()=>{closeModal('mo-history');openRoomView('DIETARY RSA');});await expect(rows.nth(1)).toContainText('1 linked work order');
});

test('empty asset choice rejects save without losing input or deducting stock; general work requires a room',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('inventory',[{id:1,_docId:'stock',description:'Lamp',qty:2}]);
  openWOModal();document.getElementById('m-wo-section').value='Electrical';fillAssetDrop();document.getElementById('m-wo-desc').value='Room lighting inspection';_woMaterials=[{invId:1,qty:1}];saveWO();
  const rejected={orders:DB.g('wo').length,stock:DB.g('inventory')[0].qty,description:document.getElementById('m-wo-desc').value,invalid:document.getElementById('m-wo-asset').getAttribute('aria-invalid')};
  document.getElementById('m-wo-asset').value='__room_general__';saveWO();const noLocation=DB.g('wo').length;
  document.getElementById('m-wo-loc').value='DIETARY RSA';saveWO();return{rejected,noLocation,saved:DB.g('wo')[0]};
 });
 expect(result.rejected).toEqual({orders:0,stock:2,description:'Room lighting inspection',invalid:'true'});expect(result.noLocation).toBe(0);expect(result.saved.workScope).toBe('room');expect(result.saved.assetDocId).toBeNull();expect(result.saved.asset).toBe('');
 await page.evaluate(()=>openRoomView('DIETARY RSA'));await expect(page.locator('#room-view-wos')).toContainText('Room lighting inspection');await expect(page.locator('#room-view-assets')).not.toContainText('1 linked work order');
});

test('review flags ambiguous, unlinked and missing assets, but excludes confirmed room work',async({page})=>{
 await page.evaluate(()=>{
  applyStoreData('assets',[...DB.g('assets'),{id:6,_docId:'duplicate-bulb',name:'COMPACT BULB 15W',section:'Electrical',location:'DIETARY RSA'}]);
  applyStoreData('wo',[{id:1,code:'AMBIGUOUS',asset:'COMPACT BULB 15W',section:'Electrical',location:'DIETARY RSA'},{id:2,code:'MISSING',asset:'Unknown',assetDocId:'deleted'},{id:3,code:'NO-SCOPE',description:'Old repair'},{id:4,code:'ROOM',workScope:'room',location:'DIETARY RSA'},{id:5,code:'UNLINKED',asset:'FLOURESCENT TUBE 18W',section:'Electrical',location:'DIETARY RSA'}]);reviewWorkOrderLinks();
 });
 await expect(page.locator('#wo-link-review')).toContainText('Multiple matching assets');await expect(page.locator('#wo-link-review')).toContainText('Referenced asset is missing');await expect(page.locator('#wo-link-review')).toContainText('Stable asset link not saved');await expect(page.locator('#wo-link-review')).not.toContainText('ROOM');
 await page.locator('#wo-link-review .card').first().getByRole('button',{name:'Review work order'}).click();await expect(page.locator('#mo-wo')).toHaveClass(/open/);
});

test('room history does not borrow same-name repairs from other rooms without a stable link',async({page})=>{
 await page.evaluate(()=>{applyStoreData('wo',[{id:1,asset:'COMPACT BULB 15W',description:'Ambiguous no-location repair'},{id:2,asset:'Previous name',assetDocId:'rsa-bulb',description:'Confirmed linked repair'}]);openRoomView('DIETARY RSA');});
 await expect(page.locator('#room-view-wos')).not.toContainText('Ambiguous no-location repair');await expect(page.locator('#room-view-wos')).toContainText('Confirmed linked repair');
});

test('CSV preserves explicit room scope and leaves ambiguous no-location imports for review',async({page})=>{
 await page.evaluate(()=>{const file=new File(['Section,Asset,Location,Description,Work Scope\nElectrical,,DIETARY RSA,General inspection,room\nElectrical,COMPACT BULB 15W,,Old repair,'],'repairs.csv');importWOCSV({target:{files:[file],value:''}});});
 await page.waitForFunction(()=>DB.g('wo').length===2);
 const result=await page.evaluate(()=>({rows:DB.g('wo'),issues:workOrderLinkIssues()}));
 expect(result.rows[0].workScope).toBe('room');expect(result.rows[0].assetDocId).toBeNull();expect(result.rows[1].assetDocId).toBeNull();expect(result.rows[1].location).toBe('');expect(result.issues).toHaveLength(1);
});

test('mobile asset selection shows the complete selected identity and remains usable',async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.evaluate(()=>createAssetWorkOrder(2));
 await expect(page.locator('#wo-selected-asset')).toContainText('OT-ELEC-DIETAR-10');await expect(page.locator('#wo-selected-asset')).toContainText('COMPACT BULB 15W');
 const bounds=await page.locator('#m-wo-asset').boundingBox();expect(bounds.width).toBeGreaterThan(250);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
 await page.locator('#m-wo-desc').fill('Mobile RSA repair');await page.getByRole('button',{name:'Save Work Order',exact:true}).click();
 expect(await page.evaluate(()=>DB.g('wo')[0].assetDocId)).toBe('rsa-bulb');
});

test('Dietary department aliases remain equivalent while RSA and other subrooms stay separate',async({page})=>{
 const result=await page.evaluate(()=>{
  applyStoreData('wo',[{id:1,asset:'Plumbing fixtures',section:'Plumbing',location:'Dietary',description:'Department sink repair'},{id:2,asset:'Cooking light',section:'Electrical',location:'DIETARY COOKING AREA',description:'Cooking area repair'}]);
  openRoomView('DIETARY RSA');return {rows:document.querySelectorAll('#room-view-assets tr').length,history:document.getElementById('room-view-wos').textContent,aliases:isSameLocation('Dietary','DIETARY DEPARTMENT'),rsa:isSameLocation('Dietary','DIETARY RSA'),cooking:isSameLocation('DIETARY RSA','DIETARY COOKING AREA')};
 });expect(result.rows).toBe(2);expect(result.aliases).toBe(true);expect(result.rsa).toBe(false);expect(result.cooking).toBe(false);expect(result.history).not.toContain('Department sink repair');expect(result.history).not.toContain('Cooking area repair');
});
