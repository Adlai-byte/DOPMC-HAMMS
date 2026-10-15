import {createSecurityService,requireEmulators,SECURITY_PROJECT} from '../security/service.mjs';

requireEmulators(SECURITY_PROJECT);
const service=await createSecurityService();
try {
  // Refuse to overlay a populated emulator. These accounts and fixtures are synthetic only.
  const existing=await service.db.listCollections();
  if(existing.length)throw Error('Demo seeding requires an empty emulator; existing data is never replaced');
  for(const [uid,role]of [['demo-staff','staff'],['demo-admin','admin']]){
    await service.auth.createUser({uid,email:uid+'@example.test',password:'Synthetic-Only-123!'});
    await service.db.doc('staff/'+uid).create({role,active:true,facilityId:'dopmc'});
  }
  await service.db.doc('system/writePolicy').create({maintenance:false});
  await service.db.doc('locations/demo-room').create({name:'Demo room'});
  console.log('Synthetic local accounts ready: demo-staff@example.test and demo-admin@example.test. Password: Synthetic-Only-123!');
}finally{await service.close();}
