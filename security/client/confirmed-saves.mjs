export class SaveError extends Error {
  constructor(code,message,details) {super(message);this.code=code;this.details=details;}
}
const failure=(code,message)=>new SaveError(code,message);
const definite=new Set(['invalid-argument','permission-denied','unauthenticated','failed-precondition','not-found','already-exists','aborted','unavailable']);
export function createConfirmedSaves({transport,isOnline=()=>navigator.onLine,onState=()=>{},timeoutMs=10000,journal=null}) {
  let uid=null,generation=0,pending=null,busy=false,state='connecting',lastVerifiedAt=null,lastSavedAt=null;
  const emit=(next,detail={})=>{state=next;onState({state,uid,pending:pending?{operationId:pending.command.operationId,store:pending.command.store}:null,lastVerifiedAt,lastSavedAt,...detail});};
  function account(nextUid) {generation++;uid=nextUid;const remembered=uid&&journal?.read(uid);pending=remembered?{uid,command:remembered,replayable:false}:null;busy=false;lastVerifiedAt=null;lastSavedAt=null;emit(pending?'outcome-unknown':nextUid?'connecting':'signed-out');}
  function clearPending(){if(uid)journal?.clear(uid);pending=null;}
  function current(g){if(g!==generation)throw failure('session-changed','Account changed; result belongs to the previous session');}
  async function call(route,body,g) {
    let timer;
    try {return await Promise.race([transport(route,structuredClone(body)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('outcome-unknown','Server response timed out')),timeoutMs);})]);}
    finally {clearTimeout(timer);current(g);}
  }
  async function verify(g=generation) {
    if(!uid)throw failure('unauthenticated','Sign in first');
    if(!isOnline()){emit('offline');throw failure('offline','Reconnect and retry; the draft was not submitted');}
    const result=await call('/inspect',{},g);current(g);
    if(result.uid!==uid)throw failure('session-changed','Server identity differs from this session');
    lastVerifiedAt=result.verifiedAt;
    if(result.maintenance)throw failure('unavailable','Maintenance is active; draft retained');
    return result;
  }
  function failed(error,submitted) {
    if(error.code==='session-changed')throw error;
    const code=error.code;
    if(submitted&&!definite.has(code)) {emit('outcome-unknown',{message:'Checking save status. Keep this draft; do not submit a different operation.'});throw failure('outcome-unknown','Save outcome unknown; check status or retry the same operation');}
    if(submitted)clearPending();
    emit(code==='aborted'?'conflict':code==='offline'?'offline':'unavailable',{message:error.message});throw error;
  }
  async function send(g) {
    const result=await call('/commands',pending.command,g);current(g);
    if(result.status!=='committed')throw failure('outcome-unknown','Server has not confirmed a committed mutation');
    const completed={command:pending.command,result};clearPending();lastSavedAt=Date.now();emit('live');return completed;
  }
  return {
    account,
    get snapshot(){return {state,uid,busy,pending:pending?structuredClone(pending):null,lastVerifiedAt,lastSavedAt};},
    async probe(){const g=generation;try {await verify(g);if(!busy&&!pending)emit('live');return true;}catch(e){if(e.code!=='session-changed')emit(pending?'outcome-unknown':isOnline()?'unavailable':'offline',{message:e.message});return false;}},
    async submit(command) {
      if(busy)throw failure('busy','A save is already in progress');
      if(pending)throw failure('outcome-unknown','Resolve the previous operation before submitting new changes');
      const g=generation;busy=true;let submitted=false;
      try {
        await verify(g);current(g);
        if(!isOnline())throw failure('offline','Connection lost before submission; draft retained');
        pending={command:{...structuredClone(command),operationId:crypto.randomUUID()},uid,replayable:true};
        // Persist only non-payload identity before dispatch; never store form contents or tokens.
        try {journal?.write(uid,{operationId:pending.command.operationId,store:command.store,command:command.command});}
        catch {pending=null;throw failure('failed-precondition','Operation identity could not be retained; nothing was submitted');}
        submitted=true;emit('saving');
        return await send(g);
      }catch(e){return failed(e,submitted);}finally{if(g===generation)busy=false;}
    },
    async reconcile({retry=false}={}) {
      if(busy)throw failure('busy','A save or status check is running');
      if(!pending)throw failure('failed-precondition','No uncertain operation');
      const g=generation;busy=true;
      try {
        await verify(g);const info=await call('/inspect',{operationId:pending.command.operationId},g);
        if(info.outcome?.status==='committed') {const completed={command:pending.command,result:info.outcome};clearPending();lastSavedAt=Date.now();emit('live');return completed;}
        // Absence is not proof of failure: an earlier request may still be executing.
        if(!retry){emit('outcome-unknown');return null;}
        if(!pending.replayable)throw failure('failed-precondition','Original payload was cleared on reload/sign-out. Check status; do not create a replacement operation.');
        emit('saving');return await send(g);
      }catch(e){if(e.code==='session-changed')throw e;emit('outcome-unknown',{message:e.message});throw e;}finally{if(g===generation)busy=false;}
    },
    disconnected(){emit(pending?'outcome-unknown':'offline');},
    async latest(store,docId){const g=generation;await verify(g);return(await call('/inspect',{store,docId},g)).record;}
  };
}
