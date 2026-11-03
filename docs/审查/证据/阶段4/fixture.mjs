import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../../../../apps/api/src/infrastructure/file-data-store.js';
import { writeJsonFileAtomically } from '../../../../apps/api/src/infrastructure/atomic-json-file.ts';
import { createAppContext } from '../../../../apps/api/src/app.factory.js';
import { createServer } from '../../../../apps/api/src/server.js';
export async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'knowra-stage4-')); const file=path.join(dir,'data.json');
 let writes=0,failAt=Infinity,server,store,app,origin;const logs=[];
 async function start(){store=createFileDataStore(file,{writeJson:(p,d)=>{if(++writes===failAt)throw new Error('review injected disk failure');writeJsonFileAtomically(p,d);}});app=createAppContext({dataStore:store,uploadsDir:path.join(dir,'uploads'),storageRootDir:dir,ownerId:'stage4-review'});server=createServer({appContext:app,logger:{error:(message,error)=>logs.push({message,code:error?.code})}});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;}
 async function stop(){if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
 await start();
 async function request(route,method='GET',body){const res=await fetch(origin+route,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const payload=await res.json();return {status:res.status,...payload};}
 return {dir,file,logs,get origin(){return origin;},get store(){return store;},request,failAfter:(n)=>{failAt=writes+n;},restart:async()=>{await stop();await start();},close:async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});}};
}
