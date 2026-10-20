import http from 'node:http';
import {Readable} from 'node:stream';
import {createReadStream,existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {root,closeStorage} from './server-env.mjs';
import * as api from '../lib/server.ts';
const port=Number(process.env.PAPERLEAF_PORT||43127);
const host='127.0.0.1';const origin=`http://${host}:${port}`;const webRoot=path.join(root,'web');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.wasm':'application/wasm','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf','.woff2':'font/woff2'};
// Consume the Node request before handing it to Web Request. Early validation
// must not cancel IncomingMessage and reset a reusable browser connection.
async function readBody(req,limit){
 if(Number(req.headers['content-length']||0)>limit){req.resume();return null;}
 return new Promise((resolve,reject)=>{let size=0;let overflow=false;const chunks=[];
  req.on('data',chunk=>{size+=chunk.length;if(size>limit){overflow=true;chunks.length=0;}if(!overflow)chunks.push(chunk);});
  req.on('end',()=>resolve(overflow?null:Buffer.concat(chunks)));req.on('error',reject);
 });
}
async function route(request){const url=new URL(request.url);const p=url.pathname;const m=request.method;
 if(p==='/api/health')return Response.json({app:'paperleaf',version:'1.0.0',mode:'local'});
 if(p==='/api/library'&&m==='GET')return api.getLibrary();
 if(p==='/api/export'&&m==='GET')return api.exportLibrary();
 if(p==='/api/import'&&m==='POST')return api.importLibrary(request);
 if(p==='/api/papers'&&m==='POST')return api.createPaper(request);
 if(p==='/api/uploads'&&m==='POST')return api.startUpload(request);
 const upload=/^\/api\/uploads\/([^/]+)(\/complete)?$/.exec(p);
 if(upload){const context={params:Promise.resolve({id:decodeURIComponent(upload[1])})};if(upload[2]&&m==='POST')return api.finishUpload(request,context);if(!upload[2]&&m==='PUT')return api.uploadPart(request,context);if(!upload[2]&&m==='DELETE')return api.cancelUpload(request,context);}
 if(p==='/api/folders'&&m==='POST')return api.createFolder(request);
 if(p==='/api/notes'&&m==='POST')return api.createNote(request);
 const match=/^\/api\/(papers|folders|notes)\/([^/]+)(\/file)?$/.exec(p);
 if(match){const context={params:Promise.resolve({id:decodeURIComponent(match[2])})};
  if(match[1]==='papers'&&match[3]){if(m==='GET')return api.getPaperFile(request,context);if(m==='POST')return api.attachPaperFile(request,context);}
  else if(!match[3]){const action={papers:{PATCH:api.updatePaper,DELETE:api.deletePaper},folders:{PATCH:api.updateFolder,DELETE:api.deleteFolder},notes:{PATCH:api.updateNote,DELETE:api.deleteNote}}[match[1]][m];if(action)return action(request,context);}
 }
 return Response.json({error:'接口不存在'}, {status:404});
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`${host}:${port}`){res.writeHead(403);res.end('Invalid host');return;}
  const url=new URL(req.url||'/',origin);if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end('Cross-origin request rejected');return;}
  if(req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Cross-site request rejected');return;}
  if(url.pathname.startsWith('/api/')){
   const init={method:req.method,headers:req.headers};if(!['GET','HEAD'].includes(req.method)){
    const limit=url.pathname.startsWith('/api/uploads/')&&req.method==='PUT'?5*1024*1024:req.headers['content-type']?.includes('multipart/form-data')?41*1024*1024:url.pathname==='/api/import'?16*1024*1024:256*1024;
    const body=await readBody(req,limit);if(body===null){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'文件或请求内容超过大小限制。',code:'PAYLOAD_TOO_LARGE'}));return;}init.body=body;
   }
   const request=new Request(url,init);const response=await api.api(()=>route(request));
   res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body){const stream=Readable.fromWeb(response.body);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy()).pipe(res);}else res.end();return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const pathname=decodeURIComponent(url.pathname);const full=path.resolve(webRoot,'.'+(pathname==='/'?'/index.html':pathname));
  if(!full.startsWith(webRoot+path.sep)||!existsSync(full)||!statSync(full).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(full)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else createReadStream(full).on('error',()=>res.destroy()).pipe(res);
 }catch(error){console.error(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'服务暂时不可用，请查看 server.log。'}));}
});
server.listen(port,host,()=>console.log(`Paperleaf local ready: ${origin}`));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
function shutdown(){server.close(()=>{closeStorage();process.exit(0);});setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
