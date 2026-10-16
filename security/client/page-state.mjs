// Pages are scoped views, never a source for dashboard totals or whole-store saves.
export function createPageState(){
  let scope=null,cursors=[null],index=0,nextCursor=null,generation=0;
  return {reset(next=null){scope=next;cursors=[null];index=0;nextCursor=null;generation++;},ticket(){return {generation,index};},request(){if(!scope)throw Error('Select a module');return {action:'list',...scope,...(cursors[index]?{cursor:cursors[index]}:{})};},accept(t,data){if(t.generation!==generation||t.index!==index)return false;nextCursor=data.nextCursor;return true;},next(){if(!nextCursor)throw Error('No next page');cursors=([...cursors.slice(0,index+1),nextCursor]);index++;nextCursor=null;generation++;},previous(){if(!index)throw Error('No previous page');index--;nextCursor=null;generation++;},get page(){return index+1;},get hasPrevious(){return index>0;}};
}
