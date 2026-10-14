import crypto from 'node:crypto';
import path from 'node:path';

export const PROJECT = 'demoapp-7864a';
export const STORES = ['wo','assets','inventory','issuance','waste','safety','projects','waterLogs','waterTank','effluent','medWasteProd','wwProd','censusLog','waterSettings','energyBills'];
export const EXTRA_PATHS = ['hammsMeta/state','hamms/mainData'];
export const DRILL_PROJECT = 'demo-hamms-recovery';
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export function allowedPath(p) {
  return EXTRA_PATHS.includes(p) || STORES.some(s => p.startsWith(`hammsStores/${s}/records/`) && p.split('/').length === 4 && p.split('/')[3]);
}
export function documentHash(d) { return sha({path:d.path, fields:d.fields}); }
export function validateBackup(b) {
  if (b.format !== 'hamms-firestore-typed-v1' || b.project !== PROJECT || b.database !== '(default)' || !Array.isArray(b.documents)) throw Error('Unsupported backup scope or format');
  if (!b.manifest || b.manifest.documentCount !== b.documents.length) throw Error('Document count mismatch');
  const seen = new Set();
  const counts = Object.fromEntries(STORES.map(s => [s,0]));
  for (const d of b.documents) {
    if (!allowedPath(d.path) || seen.has(d.path) || !d.fields || typeof d.fields !== 'object' || Array.isArray(d.fields)) throw Error('Invalid or duplicate document path/payload');
    seen.add(d.path);
    if (d.hash !== documentHash(d)) throw Error('Document hash mismatch');
    if (d.path.startsWith('hammsStores/')) counts[d.path.split('/')[1]]++;
  }
  if (canonical(counts) !== canonical(b.manifest.storeCounts)) throw Error('Store counts mismatch');
  if (b.manifest.datasetHash !== sha(b.documents.map(d => ({path:d.path,hash:d.hash})).sort((a,c)=>a.path.localeCompare(c.path)))) throw Error('Dataset hash mismatch');
  if (!Array.isArray(b.missingPaths) || b.missingPaths.some(p=>!EXTRA_PATHS.includes(p))) throw Error('Invalid missing-path manifest');
  for (const p of EXTRA_PATHS) if (Number(seen.has(p)) + b.missingPaths.filter(v=>v===p).length !== 1) throw Error('Metadata/legacy coverage incomplete');
  return counts;
}
export function emulatorBase(host, project) {
  if (project !== DRILL_PROJECT || !/^127\.0\.0\.1:\d{2,5}$/.test(host || '')) throw Error('Restore is restricted to the local recovery emulator and demo project');
  const port = Number(host.split(':')[1]);
  if (port < 1024 || port > 65535) throw Error('Invalid emulator port');
  return `http://${host}/v1/projects/${project}/databases/(default)/documents`;
}
export function assertPrivateOutput(output, repoRoot) {
  const dest = path.resolve(output), repo = path.resolve(repoRoot);
  const rel = path.relative(repo,dest);
  if (!rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel)) throw Error('Real backups must be outside the repository');
  return dest;
}
