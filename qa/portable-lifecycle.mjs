import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const bundle=process.argv[2];if(!bundle)throw new Error('Pass an extracted disposable Windows bundle directory.');
const base='http://127.0.0.1:43127';
function script(file,...args){console.log(file);const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(bundle,file),...args],{stdio:'inherit',timeout:30000});assert.equal(r.status,0,String(r.error||''));}
async function call(url,method='GET',body){const r=await fetch(base+url,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r.json();}
script('start.ps1','-NoBrowser');
const pid=await readFile(path.join(bundle,'data/server.pid'),'utf8');script('start.ps1','-NoBrowser');assert.equal(await readFile(path.join(bundle,'data/server.pid'),'utf8'),pid);
const bytes=`%PDF-1.4\n% persisted Windows lifecycle test ${Date.now()}\n%%EOF`;const form=new FormData();form.set('file',new File([bytes],'restart-test.pdf',{type:'application/pdf'}));
const paper=(await call('/api/papers','POST',form)).paper;
const note=(await call('/api/notes','POST',{paperId:paper.id,content:'重启之后还在的笔记',quote:'Useful idea',page:1})).note;
await call(`/api/papers/${paper.id}`,'PATCH',{status:'read',currentPage:2,pageCount:3,revision:paper.revision});
script('stop.ps1');
script('start.ps1','-NoBrowser');
const library=await call('/api/library');const saved=library.papers.find(p=>p.id===paper.id);assert.equal(saved.status,'read');assert.equal(saved.currentPage,2);assert.equal(library.notes.find(n=>n.id===note.id).content,note.content);
assert.equal(await (await fetch(base+`/api/papers/${paper.id}/file`)).text(),bytes);
const html=await(await fetch(base)).text();assert.match(html,/纸间/);const asset=html.match(/src="([^"]+\.js)"/)[1];assert.equal((await fetch(base+asset)).status,200);
await call(`/api/papers/${paper.id}?revision=${saved.revision}`,'DELETE');script('stop.ps1');
await writeFile('qa/portable-lifecycle-results.json',JSON.stringify({passed:true,testedAt:new Date().toISOString(),tests:['Bundled Node starts via Windows launcher','Second launch reuses running server','PDF, notes, status and reading page survive stop/restart','Production HTML and JS served','Owned server stops correctly']},null,2));
console.log('PASS Packaged Windows start/stop, idempotent launch, restart persistence, PDF bytes and production assets');
