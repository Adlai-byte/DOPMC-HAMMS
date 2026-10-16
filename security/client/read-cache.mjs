export function createReadCache({maxPages=12,maxAgeMs=60000,now=()=>Date.now()}={}){
  const pages=new Map(),key=request=>JSON.stringify(request);
  return {get(request){const k=key(request),entry=pages.get(k);if(!entry)return null;if(now()-entry.at>maxAgeMs){pages.delete(k);return null;}pages.delete(k);pages.set(k,entry);return structuredClone(entry.data);},put(request,data){const k=key(request);pages.delete(k);pages.set(k,{at:now(),data:structuredClone(data)});while(pages.size>maxPages)pages.delete(pages.keys().next().value);},clear(){pages.clear();},get size(){return pages.size;}};
}
