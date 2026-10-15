export const fixtures={
  wo:{section:'Electrical',description:'Synthetic room inspection',status:'Open',priority:'High',workScope:'room',locationId:'test-room'},
  assets:{name:'Synthetic asset',section:'Electrical',location:'Test room',qty:0},
  inventory:{description:'Synthetic inventory',category:'Electrical',unit:'piece',qty:0,minLevel:0},
  issuance:{date:'2026-10-15',description:'Synthetic issuance',qtyIssued:1,issuedTo:'Test staff',invDocId:'test-inventory'},
  waste:{date:'2026-10-15',type:'Sharps',volume:0},
  safety:{date:'2026-10-15',description:'Synthetic issue',severity:'Low',status:'Open'},
  projects:{code:'TEST-PROJECT',title:'Synthetic project',status:'Proposed',budget:0,physicalPct:0},
  waterLogs:{date:'2026-10-15',ward:'Test ward',testType:'Residual Chlorine',result:'Safe',chlorine:0},
  waterTank:{dateTime:'2026-10-15T08:00',tankName:'Test tank',tankLevel:0,patientCount:0},
  effluent:{date:'2026-10-15',samplingPoint:'Test outlet',status:'Pending Analysis',pH:0},
  medWasteProd:{date:'2026-10-15',shift:'AM',status:'Normal',inputQty:0},
  wwProd:{date:'2026-10-15',shift:'AM',status:'Normal',inflow:0},
  censusLog:{date:'2026-10-15',count:0},
  waterSettings:{pumpLph:0,staffPresenceFactor:0,showAlarmPanel:false},
  energyBills:{period:'2026-10',actualKwh:1,billAmount:1}
};
