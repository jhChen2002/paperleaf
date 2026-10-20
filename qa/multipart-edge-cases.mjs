import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const base=process.env.PAPERLEAF_TEST_URL||'http://127.0.0.1:5173';
const headers=base.includes(':5173')?{Cookie:'__sites_local_auth=1'}:{};
const papers=new Set(),uploads=new Set(),checks=[];
const stamp=Date.now();
async function req(path,method='GET',body,extra={}){
 const response=await fetch(base+path,{method,headers:{...headers,...extra,...body?{'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json'}:{}},body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined,redirect:'manual'});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
}
function expect(result,status){assert.equal(result.status,status,JSON.stringify(result.data));return result.data;}
async function start(bytes,extra={}){const result=expect(await req('/api/uploads','POST',{fileName:'QA-edge.pdf',fileSize:bytes.length,fileHash:createHash('sha256').update(bytes).digest('hex'),...extra}),201);uploads.add(result.id);return result;}
async function stage(upload,bytes){return [expect(await req(`/api/uploads/${upload.id}?part=1`,'PUT',bytes),200)];}
async function finish(upload,parts){const result=expect(await req(`/api/uploads/${upload.id}/complete`,'POST',{parts}),200).paper;papers.add(result.id);return result;}
async function reference(){const result=expect(await req('/api/papers','POST',{title:'QA attachment '+stamp}),201).paper;papers.add(result.id);return result;}
try{
 if(base.includes(':5173')){
  for(const [path,method,body] of [['/api/uploads','POST',{}],['/api/uploads/00000000-0000-4000-8000-000000000000?part=1','PUT',Buffer.from('x')],['/api/uploads/00000000-0000-4000-8000-000000000000/complete','POST',{}],['/api/uploads/00000000-0000-4000-8000-000000000000','DELETE']])expect(await req(path,method,body,{Cookie:''}),401);
  checks.push('all multipart routes reject anonymous requests');
 }
 const duplicateBytes=Buffer.from('%PDF-1.4\n% simultaneous duplicate '+stamp);
 const first=await start(duplicateBytes),second=await start(duplicateBytes);
 const firstParts=await stage(first,duplicateBytes),secondParts=await stage(second,duplicateBytes);
 const firstPaper=await finish(first,firstParts),secondPaper=await finish(second,secondParts);
 assert.equal(secondPaper.id,firstPaper.id);
 assert.equal((await finish(second,secondParts)).id,firstPaper.id);
 expect(await req(`/api/uploads/${second.id}`,'DELETE'),200);
 assert.equal((await req(`/api/papers/${firstPaper.id}/file`)).status,200);
 checks.push('deduplicated completion receipt survives retry and cancellation preserves saved file');

 const target=await reference(),attachBytes=Buffer.from('%PDF-1.4\n% attachment conflict '+stamp);
 const stale=await start(attachBytes,{paperId:target.id,revision:target.revision}),staleParts=await stage(stale,attachBytes);
 const edited=expect(await req(`/api/papers/${target.id}`,'PATCH',{revision:target.revision,title:'QA edited during upload'}),200).paper;
 assert.equal(expect(await req(`/api/uploads/${stale.id}/complete`,'POST',{parts:staleParts}),409).code,'REVISION_CONFLICT');
 expect(await req(`/api/uploads/${stale.id}?part=1`,'PUT',attachBytes),404);
 const fresh=await start(attachBytes,{paperId:target.id,revision:edited.revision}),freshParts=await stage(fresh,attachBytes);
 const attached=await finish(fresh,freshParts);
 const updated=expect(await req(`/api/papers/${target.id}`,'PATCH',{revision:attached.revision,starred:true}),200).paper;
 assert.equal((await finish(fresh,freshParts)).revision,updated.revision);
 expect(await req(`/api/uploads/${fresh.id}`,'DELETE'),200);
 assert.equal((await req(`/api/papers/${target.id}/file`)).status,200);
 checks.push('stale attachment session discarded; fresh retry and completed receipt remain safe');

 const otherTarget=await reference(),raceBytes=Buffer.from('%PDF-1.4\n% competing attachment '+stamp);
 const attachment=await start(raceBytes,{paperId:otherTarget.id,revision:otherTarget.revision}),imported=await start(raceBytes);
 const attachmentParts=await stage(attachment,raceBytes),importedParts=await stage(imported,raceBytes);
 const winner=await finish(imported,importedParts);
 assert.equal(expect(await req(`/api/uploads/${attachment.id}/complete`,'POST',{parts:attachmentParts}),409).code,'DUPLICATE_FILE');
 expect(await req(`/api/uploads/${attachment.id}?part=1`,'PUT',raceBytes),404);
 assert.equal((await req(`/api/papers/${winner.id}/file`)).status,200);
 checks.push('concurrent duplicate attachment returns actionable conflict and cleans its upload');
 const unnamedBytes=Buffer.from('%PDF-1.4\n% unnamed '+stamp),unnamed=await start(unnamedBytes,{fileName:'.pdf'});
 assert.equal((await finish(unnamed,await stage(unnamed,unnamedBytes))).title,'未命名文献');
 checks.push('extension-only PDF filename imports with a usable title');
 const report={passed:true,base,checks};await writeFile('qa/multipart-edge-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 for(const id of uploads)await req(`/api/uploads/${id}`,'DELETE');
 const library=expect(await req('/api/library'),200);
 for(const paper of library.papers.filter(p=>papers.has(p.id)))await req(`/api/papers/${paper.id}?revision=${paper.revision}`,'DELETE');
}
