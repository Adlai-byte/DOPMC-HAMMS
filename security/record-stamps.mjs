import {FieldValue} from 'firebase-admin/firestore';
export function stampRecord(record,docId,actor,version){
  return {...record,_docId:docId,_v:version,_updatedBy:actor.email,_updatedAt:Date.now(),_committedAt:FieldValue.serverTimestamp()};
}
// Typed recovery counterpart: keep business fields byte-for-byte and advance existing
// identities beyond both versions so a pre-recovery draft cannot pass the version check.
// Unversioned legacy records remain unversioned; recovery is not an identity migration.
export function stampRecoveryFields(fields,path,actor,at,minimumVersion=0){
  const version=Number(fields._v?.integerValue);
  if(!Number.isSafeInteger(version)||version<1)return fields;
  const r=stampRecord({},path.split('/').at(-1),actor,Math.max(version,minimumVersion)+1);
  return {...fields,_docId:{stringValue:r._docId},_v:{integerValue:String(r._v)},_updatedBy:{stringValue:r._updatedBy},_updatedAt:{integerValue:String(Date.parse(at))},_recoveryPreparedAt:{timestampValue:at}};
}
