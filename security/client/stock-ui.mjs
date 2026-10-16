export function installStockUI({submit,request,notify,toast,watchModal}){
  const value=id=>document.getElementById(id)?.value||'';
  const inventory=id=>DB.g('inventory').find(i=>i._docId===id||String(i.id)===String(id));
  const itemVersions=ids=>Object.fromEntries([...new Set(ids)].map(id=>{const item=inventory(id);if(!item)throw Error('Inventory item unavailable');return[id,item._v];}));
  function scope(record,old){
    if(window.HAMMS_PHASE5){Object.assign(record,window.HAMMS_PHASE5.formScope(old));return;}
    if(old){if(old.workScope)record.workScope=old.workScope;if(old.assetDocId)record.assetDocId=old.assetDocId;if(old.locationId)record.locationId=old.locationId;return;}
    const matches=DB.g('assets').filter(a=>a.name===record.asset&&a.section===record.section);
    const locations=(window._phase3Locations||[]).filter(l=>l.name===record.location);
    if(record.asset&&record.asset!=='__room_general__'){if(matches.length!==1)throw Error('Choose a unique registered asset');record.workScope='asset';record.assetDocId=matches[0]._docId;}
    else{if(locations.length!==1)throw Error('Choose an exact registered room');record.workScope='room';record.locationId=locations[0].docId;}
  }
  // Explicit WO adapter avoids the legacy restore/deduct and automatic-issuance regeneration code.
  window.saveWO=async()=>{try{
    const old=DB.g('wo').find(w=>w.id===_editWO),sec=value('m-wo-section');
    const record={section:sec,asset:value('m-wo-asset'),location:value('m-wo-loc').trim(),description:value('m-wo-desc').trim(),priority:value('m-wo-priority'),status:value('m-wo-status'),dateStart:value('m-wo-dstart'),dateEnd:value('m-wo-dend'),targetCompletionDate:value('m-wo-target-completion')||null,assigned:value('m-wo-assigned'),remarks:value('m-wo-remarks'),delayReason:value('m-wo-delay-reason')||null,delayReasonOther:value('m-wo-delay-other'),serviceReport:document._woReport||old?.serviceReport||null};
    if(!sec||!record.description)throw Error('Section and description are required');scope(record,old);
    record.code=old?.code||generateModuleCode('wo',[SEC_ABV[sec]||'GEN',PRI_ABV[record.priority]||'MD']);
    const materials=_woMaterials.map(m=>{const item=inventory(Object.hasOwn(m,'invId')?m.invId:m.invDocId);if(!item)throw Error('Selected inventory item unavailable');if(m.invDocId&&m.invDocId!==item._docId)m.lineId=crypto.randomUUID();m.invDocId=item._docId;m.lineId=m.lineId||crypto.randomUUID();return {lineId:m.lineId,invDocId:item._docId,qty:Number(m.qty),issuedTo:m.issuedTo||''};});
    const ids=[...materials.map(m=>m.invDocId),...(old?.materials||[]).map(m=>m.invDocId)];if(ids.some(id=>!id))throw Error('Legacy materials require reviewed linking');
    const oldTotals=new Map();for(const m of old?.materials||[])oldTotals.set(m.invDocId,(oldTotals.get(m.invDocId)||0)+m.qty);
    const nextTotals=new Map();for(const m of materials)nextTotals.set(m.invDocId,(nextTotals.get(m.invDocId)||0)+m.qty);
    const reduction=[...oldTotals].some(([id,qty])=>(nextTotals.get(id)||0)<qty);
    let confirmedReturn=false;
    if(reduction){confirmedReturn=await confirmDialog('Confirm that the reduced quantities are unused materials physically returned to stock. A return reason is required in Remarks.',{title:'Physical material return',confirmText:'Confirm Physical Return'});if(!confirmedReturn)return;if(!record.remarks.trim())throw Error('Enter a physical-return reason in Remarks');}
    const snapshot=_editSnapshots.get('wo');
    await submit({command:'saveWorkOrder',store:'wo',...(old?{docId:old._docId}:{}),expectedVersion:old?(snapshot?.id===old.id?snapshot._v:old._v):0,reason:record.remarks.trim()||'Work-order material allocation submitted by staff',payload:{record,materials,inventoryVersions:itemVersions(ids),confirmedReturn}},['mo-wo']);
  }catch(e){notify(e);}};
  window.saveManualIssue=async()=>{try{
    if(_editIssuance!=null)return await window.saveIssuanceEdit();
    const item=inventory(value('m-iss-item'));if(!item)throw Error('Select an inventory item');const reason=value('m-iss-remarks').trim();if(!reason)throw Error('An issuance reason is required in Remarks');
    await submit({command:'issueStock',store:'issuance',expectedVersion:0,reason,payload:{invDocId:item._docId,qty:Number(value('m-iss-qty')),issuedTo:value('m-iss-to').trim(),date:value('m-iss-date'),inventoryVersion:item._v,woRef:value('m-iss-wo'),...(value('m-iss-section')?{section:value('m-iss-section')}:{})}},['mo-issue']);
  }catch(e){notify(e);}};
  window.saveIssuanceEdit=async()=>{try{
    const old=DB.g('issuance').find(r=>r.id===_editIssuance);if(!old||old.source!=='manual')throw Error('Automatic issuance is edited through its work order');
    if(String(value('m-iss-item'))!==String(old.invId))throw Error('This issuance has already been saved. Reopen the form to issue a different item.');
    const reason=value('m-iss-remarks').trim();if(!reason)throw Error('An amendment reason is required');
    const qty=Number(value('m-iss-qty'));let confirmedReturn=false;
    if(qty<old.qtyIssued){confirmedReturn=await confirmDialog('Confirm the quantity reduction represents unused material physically returned.',{title:'Physical return',confirmText:'Confirm Physical Return'});if(!confirmedReturn)return;}
    await submit({command:'amendManualIssue',store:'issuance',docId:old._docId,expectedVersion:_editSnapshots.get('issuance')?._v||old._v,reason,payload:{qty,issuedTo:value('m-iss-to').trim(),date:value('m-iss-date'),inventoryVersion:inventory(old.invDocId)?._v,confirmedReturn,woRef:value('m-iss-wo'),...(value('m-iss-section')?{section:value('m-iss-section')}:{})}},['mo-issue']);
  }catch(e){notify(e);}};
  const remarks=document.getElementById('m-iss-remarks');if(remarks)remarks.placeholder='Required issuance reason';

  const overlay=document.createElement('div');overlay.className='modal-overlay';overlay.id='mo-stock-movement';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','stock-movement-title');
  overlay.innerHTML='<div class="modal"><div class="modal-header"><h3 id="stock-movement-title">Stock movement</h3><button type="button" class="modal-close" aria-label="Close">×</button></div><div class="modal-body"><form id="stock-movement-form"><div class="form-group"><label for="stock-action">Action</label><select id="stock-action"><option value="receiveStock">Receive stock</option><option value="adjustStock">Adjust stock</option><option value="returnStock">Return unused manual issuance</option></select></div><div class="form-group"><label for="stock-item">Inventory / manual issuance</label><select id="stock-item"></select></div><div class="form-group"><label for="stock-quantity">Quantity (signed for adjustment)</label><input id="stock-quantity" type="number" step="0.0001" required></div><div class="form-group"><label for="stock-reference">Delivery / adjustment reference</label><input id="stock-reference" maxlength="300"></div><div class="form-group"><label for="stock-reason">Reason (required)</label><textarea id="stock-reason" maxlength="1000" required></textarea></div><label><input type="checkbox" id="stock-physical"> Unused materials were physically returned</label><div class="modal-footer"><button type="submit" class="btn btn-primary">Confirm movement</button></div></form></div></div>';
  document.body.append(overlay);watchModal?.(overlay);overlay.querySelector('.modal-close').onclick=()=>closeModal(overlay.id);
  let selection=null;
  window.addEventListener('hamms-session-ended',()=>{selection=null;document.getElementById('phase4-ledger')?.replaceChildren();});
  function choose(){const select=document.getElementById('stock-item'),kind=value('stock-action');selection=kind==='returnStock'?DB.g('issuance').find(r=>r._docId===select.value):inventory(select.value);selection=selection?JSON.parse(JSON.stringify(selection)):null;}
  function choices(selected){const select=document.getElementById('stock-item');select.replaceChildren();const rows=value('stock-action')==='returnStock'?DB.g('issuance').filter(r=>r.source==='manual'&&!r._archived):DB.g('inventory');for(const row of rows){const option=document.createElement('option');option.value=row._docId;option.textContent=(row.description||row.code||row._docId)+' · '+(row.qty??row.qtyIssued)+' '+(row.unit||'');select.append(option);}if(selected)select.value=selected;choose();}
  document.getElementById('stock-action').onchange=()=>choices();document.getElementById('stock-item').onchange=choose;
  document.getElementById('stock-movement-form').onsubmit=async event=>{event.preventDefault();try{
    if(!selection)throw Error('Select a record');const kind=value('stock-action'),reason=value('stock-reason').trim();if(!reason)throw Error('A reason is required');
    const payload=kind==='returnStock'?{qty:Number(value('stock-quantity')),confirmedReturn:document.getElementById('stock-physical').checked,inventoryVersion:inventory(selection.invDocId)?._v}:{quantity:Number(value('stock-quantity')),reference:value('stock-reference')};
    await submit({command:kind,store:kind==='returnStock'?'issuance':'inventory',docId:selection._docId,expectedVersion:selection._v,reason,payload},[overlay.id]);
  }catch(e){notify(e);}};
  function openMovement(action='receiveStock',id){document.getElementById('stock-movement-form').reset();document.getElementById('stock-action').value=action;choices(id);openModal(overlay.id);}

  const panel=document.createElement('div');panel.className='card';panel.id='phase4-stock-panel';const header=document.createElement('div');header.className='card-header';const title=document.createElement('h3');title.textContent='Stock ledger · local emulator';header.append(title);panel.append(header);
  for(const [label,action]of [['Receive stock','receiveStock'],['Adjust stock','adjustStock'],['Return unused material','returnStock']]){const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent=label;button.onclick=()=>openMovement(action);header.append(button);}
  const read=document.createElement('button');read.type='button';read.className='btn btn-ghost';read.textContent='Review movement ledger';header.append(read);const ledger=document.createElement('pre');ledger.id='phase4-ledger';ledger.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;padding:12px';panel.append(ledger);read.onclick=async()=>{try{const data=await request('/inspect',{stock:true});ledger.textContent=JSON.stringify({ledgers:data.ledgers,movements:data.movements},null,2);}catch(e){notify(e);}};
  document.getElementById('page-inventory').prepend(panel);

  // Lifecycle actions require an explicit reason; return quantities remain explicit command data.
  async function lifecycle(command,docId,{reason,returns=[],confirmedReturn=false}={}){
    const wo=(window._phase4AllWO||DB.g('wo')).find(w=>w._docId===docId);if(!wo)throw Error('Work order unavailable');
    const payload=command==='cancelWorkOrder'?{returns,confirmedReturn,inventoryVersions:itemVersions((wo.materials||[]).map(m=>m.invDocId))}:{};
    await submit({command,store:'wo',docId,expectedVersion:wo._v,reason,payload});
  }
  const lifecycleModal=document.createElement('div');lifecycleModal.className='modal-overlay';lifecycleModal.id='mo-stock-wo-action';lifecycleModal.setAttribute('role','dialog');lifecycleModal.setAttribute('aria-modal','true');lifecycleModal.setAttribute('aria-labelledby','stock-wo-title');
  lifecycleModal.innerHTML='<div class="modal"><div class="modal-header"><h3 id="stock-wo-title">Work-order materials and archival</h3><button class="modal-close" type="button" aria-label="Close">×</button></div><div class="modal-body"><form id="stock-wo-form"><div class="form-group"><label for="stock-wo-action">Action</label><select id="stock-wo-action"><option value="cancelWorkOrder">Cancel work order</option><option value="archiveWorkOrder">Archive work order</option><option value="restoreWorkOrder">Restore archived work order (admin)</option><option value="reopenWorkOrder">Reopen cancelled work order (admin)</option></select></div><div class="form-group"><label for="stock-wo-record">Work order</label><select id="stock-wo-record"></select></div><div id="stock-wo-returns"></div><label><input id="stock-wo-physical" type="checkbox"> Entered quantities were physically returned unused</label><div class="form-group"><label for="stock-wo-reason">Reason (required)</label><textarea id="stock-wo-reason" required maxlength="1000"></textarea></div><p>Cancellation and archival do not automatically return stock. Reopening does not reissue materials.</p><div class="modal-footer"><button type="submit" class="btn btn-primary">Confirm action</button></div></form></div></div>';
  document.body.append(lifecycleModal);watchModal?.(lifecycleModal);lifecycleModal.querySelector('.modal-close').onclick=()=>closeModal(lifecycleModal.id);
  function returnRows(){const wo=(window._phase4AllWO||[]).find(w=>w._docId===value('stock-wo-record')),rows=document.getElementById('stock-wo-returns');rows.replaceChildren();if(value('stock-wo-action')!=='cancelWorkOrder')return;
    for(const m of wo?.materials||[]){const group=document.createElement('div');group.className='form-group';const label=document.createElement('label'),input=document.createElement('input');input.type='number';input.min='0';input.max=String(m.qty);input.step='0.0001';input.value='0';input.id='return-'+m.lineId;input.dataset.lineId=m.lineId;label.htmlFor=input.id;label.textContent=(m.name||m.invDocId)+' · return up to '+m.qty+' '+(m.unit||'');group.append(label,input);rows.append(group);}
  }
  document.getElementById('stock-wo-record').onchange=returnRows;document.getElementById('stock-wo-action').onchange=returnRows;
  function openWorkOrder(){document.getElementById('stock-wo-form').reset();const select=document.getElementById('stock-wo-record');select.replaceChildren();for(const wo of window._phase4AllWO||[]){const option=document.createElement('option');option.value=wo._docId;option.textContent=(wo.code||wo._docId)+' · '+wo.status+(wo._archived?' · Archived':'');select.append(option);}returnRows();openModal(lifecycleModal.id);}
  document.getElementById('stock-wo-form').onsubmit=async event=>{event.preventDefault();try{
    const returns=[...document.querySelectorAll('#stock-wo-returns input')].filter(e=>Number(e.value)>0).map(e=>({lineId:e.dataset.lineId,qty:Number(e.value)}));
    await lifecycle(value('stock-wo-action'),value('stock-wo-record'),{reason:value('stock-wo-reason').trim(),returns,confirmedReturn:document.getElementById('stock-wo-physical').checked});
    closeModal(lifecycleModal.id);
  }catch(e){notify(e);}};
  const lifecycleButton=document.createElement('button');lifecycleButton.type='button';lifecycleButton.className='btn btn-ghost';lifecycleButton.textContent='WO cancellation / archive';lifecycleButton.onclick=openWorkOrder;header.append(lifecycleButton);
  window.HAMMS_PHASE4={openMovement,lifecycle,openWorkOrder};
}
