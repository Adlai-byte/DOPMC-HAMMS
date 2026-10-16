import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertPrivateOutput,sha} from './recovery-core.mjs';
import {validateRecoveryBackup,scalar} from '../security/recovery-domain.mjs';
import {validateImage} from '../security/attachments.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project='demo-hamms-security';
export async function exportAttachmentBundle({recovery,attachments,token,output}){
  output=assertPrivateOutput(output,root);const backup=await recovery(token,{action:'snapshot'}),objects=[];await fs.mkdir(path.join(output,'objects'),{recursive:true,mode:0o700});
  for(const d of backup.documents.filter(d=>d.path.startsWith('attachments/'))){
    if(!['attached','retained-orphan'].includes(scalar(d.fields.state)))throw Error('Pending images require review before an attachment bundle can be exported');
    const id=d.path.split('/')[1];if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid original attachment identity');
    const response=await attachments(token,{action:'readBackup',attachmentId:id}),bytes=Buffer.from(response.base64,'base64'),hash=sha(response.base64);
    if(hash!==scalar(d.fields.hash)||bytes.length!==scalar(d.fields.size))throw Error('Attachment changed during backup');
    await fs.writeFile(path.join(output,'objects',id+'.bin'),bytes,{flag:'wx',mode:0o600});objects.push({id,path:'objects/'+id+'.bin',hash,size:bytes.length,contentType:scalar(d.fields.contentType)});
  }
  const manifest={format:'hamms-private-attachment-bundle-v1',project,backup,objects,manifestHash:sha({backupHash:backup.manifest.datasetHash,objects})};await fs.writeFile(path.join(output,'bundle.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});return {output,documents:backup.documents.length,objects:objects.length,manifestHash:manifest.manifestHash};
}
export async function validateAttachmentBundle(input){
  const directory=assertPrivateOutput(input,root),bundle=JSON.parse(await fs.readFile(path.join(directory,'bundle.json'),'utf8'));validateRecoveryBackup(bundle.backup,project);
  if(bundle.format!=='hamms-private-attachment-bundle-v1'||bundle.project!==project||!Array.isArray(bundle.objects)||bundle.manifestHash!==sha({backupHash:bundle.backup.manifest.datasetHash,objects:bundle.objects}))throw Error('Invalid binary bundle manifest');
  const expected=new Map(bundle.backup.documents.filter(d=>d.path.startsWith('attachments/')).map(d=>[d.path.split('/')[1],d]));if(expected.size!==bundle.objects.length||new Set(bundle.objects.map(o=>o.id)).size!==expected.size)throw Error('Binary coverage mismatch');
  const binaries=[];
  for(const o of bundle.objects){
    const d=expected.get(o.id);if(!d||!/^[a-f0-9]{64}$/.test(o.id)||o.path!=='objects/'+o.id+'.bin'||o.hash!==scalar(d.fields.hash)||o.size!==scalar(d.fields.size)||o.contentType!==scalar(d.fields.contentType))throw Error('Invalid attachment binary identity/metadata');
    const bytes=await fs.readFile(path.join(directory,o.path));if(bytes.length!==o.size||sha(bytes.toString('base64'))!==o.hash)throw Error('Attachment binary hash mismatch');validateImage(bytes.toString('base64'),o.contentType);binaries.push({...o,base64:bytes.toString('base64')});
  }
  return {bundle,binaries};
}
export async function stageAttachmentBundle({attachments,token,input}){
  // Validate every file before the first write. Staging never overwrites a differing
  // existing object and does not mutate or relink any operational record/metadata.
  const {bundle,binaries}=await validateAttachmentBundle(input);
  for(const b of binaries)await attachments(token,{action:'stageBinary',attachmentId:b.id,base64:b.base64,contentType:b.contentType,hash:b.hash});
  return {backup:bundle.backup,stagedObjects:binaries.length,next:'Stage recovery, verify the complete proposed before/after payloads, then approve the exact preview.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,url,directory]=process.argv.slice(2),parsed=new URL(url),token=process.env.HAMMS_EMULATOR_ADMIN_TOKEN;
  if(parsed.hostname!=='127.0.0.1'||parsed.protocol!=='http:'||parsed.username||parsed.password||parsed.pathname!=='/'||!token)throw Error('A loopback emulator command service URL and HAMMS_EMULATOR_ADMIN_TOKEN are required');
  const call=route=>async(_token,body)=>{const r=await fetch(parsed.origin+route,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-HAMMS-Protocol':'8'},body:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Error(data.error?.message||'Emulator request failed');return data;};
  const attachments=call('/attachments'),recovery=call('/recovery');
  if(mode==='export')console.log(JSON.stringify(await exportAttachmentBundle({recovery,attachments,token,output:directory})));
  else if(mode==='validate'){const {bundle}=await validateAttachmentBundle(directory);console.log(JSON.stringify({valid:true,documents:bundle.backup.documents.length,objects:bundle.objects.length,manifestHash:bundle.manifestHash}));}
  else if(mode==='stage'){const result=await stageAttachmentBundle({attachments,token,input:directory});console.log(JSON.stringify({stagedObjects:result.stagedObjects,next:result.next}));}
  else throw Error('Usage: node scripts/attachment-bundle.mjs export|validate|stage http://127.0.0.1:PORT/ PRIVATE_DIRECTORY');
}
