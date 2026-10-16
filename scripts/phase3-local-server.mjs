import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSecurityService,requireEmulators,SECURITY_PROJECT} from '../security/service.mjs';
import {SCHEMAS} from '../security/validation.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function createLocalHarness(options={}) {
  requireEmulators(SECURITY_PROJECT);const service=await createSecurityService(SECURITY_PROJECT,options),upstream=await service.listen();
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/schema.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Object.fromEntries(Object.entries(SCHEMAS).map(([k,v])=>[k,Object.keys(v.fields)]))));return;}
      if(req.method==='POST'&&['/api/commands','/api/inspect','/api/login','/api/recovery'].includes(url.pathname)) {
        if(req.headers.origin) {
          const origin=new URL(req.headers.origin);if(origin.hostname!=='127.0.0.1'||origin.port!==String(server.address().port)){res.writeHead(403);res.end();return;}
        }
        let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(url.pathname==='/api/recovery'?20000000:800000))throw Error('Request too large');chunks.push(chunk);}
        const body=Buffer.concat(chunks);
        const destination=url.pathname==='/api/login'?'http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key':upstream+url.pathname.slice(4);
        const r=await fetch(destination,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(req.headers.authorization?{Authorization:req.headers.authorization}:{})},body});
        res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text());return;
      }
      const assets={
        '/confirmed-saves.mjs':'security/client/confirmed-saves.mjs',
        '/app-bridge.mjs':'security/client/app-bridge.mjs'
        ,'/stock-ui.mjs':'security/client/stock-ui.mjs'
        ,'/relationship-ui.mjs':'security/client/relationship-ui.mjs'
        ,'/relationship-domain.mjs':'security/relationship-domain.mjs'
        ,'/analysis-ui.mjs':'security/client/analysis-ui.mjs'
        ,'/analysis-domain.mjs':'security/analysis-domain.mjs'
        ,'/recovery-ui.mjs':'security/client/recovery-ui.mjs'
      };
      if(assets[url.pathname]) {res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(root,assets[url.pathname]),'utf8'));return;}
      if(url.pathname==='/'||url.pathname==='/index.html') {
        let html=await fs.readFile(path.join(root,'public/index.html'),'utf8');
        // Generated local view only. No production Firebase SDK/init or cached shell can run here.
        html=html.replace(/<script type="module">[\s\S]*?<\/script>/,'<script>window._FB={enabled:false};</script>');
        html=html.replace('const FIREBASE_ENABLED = true;','const FIREBASE_ENABLED = false;');
        // Local stock workflow projections; original hosted source stays untouched.
        html=html.replace("(w.status!=='Closed'&&w.status!=='Completed')", "(w.status!=='Closed'&&w.status!=='Completed'&&w.status!=='Cancelled')");
        html=html.replace("const fromWO=l.woRef&&l.woRef!=='—';", "const fromWO=l.source?l.source!=='manual':l.woRef&&l.woRef!=='—';");
        html=html.replace('${l.qtyIssued}</td>', '${l.qtyIssued}<small style="display:block">Returned: ${l.qtyReturned||0} · Net: ${Number((l.qtyIssued-(l.qtyReturned||0)).toFixed(4))}</small></td>');
        html=html.replaceAll("s.status!=='Closed'&&s.status!=='Resolved'", "!['Closed','Resolved','Verified'].includes(s.status)");
        html=html.replaceAll("s.status==='Closed'||s.status==='Resolved'", "['Closed','Resolved','Verified'].includes(s.status)");
        html=html.replace('</body>','<script type="module" src="/app-bridge.mjs"></script></body>');
        res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;
      }
      // No service worker, Firebase SDK proxy, file browsing or public backup routes.
      res.writeHead(404);res.end('Not found');
    }catch{res.writeHead(500);res.end('Local harness request failed');}
  });
  return {service,async listen(port=0){await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;},async close(){if(server.listening)await new Promise(resolve=>server.close(resolve));await service.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const harness=await createLocalHarness();console.log('Emulator-only HAMMS: '+await harness.listen(3001));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await harness.close();process.exit(0);});
}
