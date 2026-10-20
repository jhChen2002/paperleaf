import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const base=process.env.PAPERLEAF_TEST_URL||'http://127.0.0.1:43128';const headers=base.includes(':5173')?{Cookie:'__sites_local_auth=1'}:{};
async function req(path,method='GET',body){const response=await fetch(base+path,{method,headers:{...headers,...body?{'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json'}:{}},body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined});let data=await response.text();try{data=JSON.parse(data)}catch{}return {status:response.status,data};}
function expect(result,status){assert.equal(result.status,status,JSON.stringify(result.data));return result.data;}
const bytes=Buffer.concat([await readFile('qa/continuous-20mb.pdf'),Buffer.from('\n% QA '+Date.now())]);const hash=createHash('sha256').update(bytes).digest('hex');const started=performance.now();
let paper;const upload=expect(await req('/api/uploads','POST',{fileName:'QA-multipart.pdf',fileSize:bytes.length,fileHash:hash}),201);
try{
 const parts=[];const total=Math.ceil(bytes.length/upload.partSize);
 expect(await req('/api/uploads/'+upload.id+'?part=1','PUT',bytes.subarray(0,100)),400);
 expect(await req('/api/uploads/'+upload.id+'/complete','POST',{parts:[]}),400);
 for(let i=0;i<total;i++){const piece=bytes.subarray(i*upload.partSize,(i+1)*upload.partSize);const result=expect(await req('/api/uploads/'+upload.id+'?part='+(i+1),'PUT',piece),200);parts.push(result);
  if(i===0){const repeated=expect(await req('/api/uploads/'+upload.id+'?part=1','PUT',piece),200);assert.equal(repeated.partNumber,1);parts[0]=repeated;}
  if(i===total-2)expect(await req('/api/uploads/'+upload.id+'/complete','POST',{parts}),400);
 }
 paper=expect(await req('/api/uploads/'+upload.id+'/complete','POST',{parts}),200).paper;
 assert.equal(expect(await req('/api/uploads/'+upload.id+'/complete','POST',{parts}),200).paper.id,paper.id);
 const downloaded=Buffer.from(await(await fetch(base+'/api/papers/'+paper.id+'/file',{headers})).arrayBuffer());assert.equal(createHash('sha256').update(downloaded).digest('hex'),hash);
 const duplicate=expect(await req('/api/uploads','POST',{fileName:'same.pdf',fileSize:bytes.length,fileHash:hash}),200);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.paper.id,paper.id);
 const range=await fetch(base+'/api/papers/'+paper.id+'/file',{headers:{...headers,Range:'bytes=1048576-2097151'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(1048576,2097152));
 const badBytes=Buffer.from('%PDF-1.4\n% corrupt hash test'),bad=expect(await req('/api/uploads','POST',{fileName:'bad.pdf',fileSize:badBytes.length,fileHash:'0'.repeat(64)}),201);
 const badPart=expect(await req('/api/uploads/'+bad.id+'?part=1','PUT',badBytes),200);expect(await req('/api/uploads/'+bad.id+'/complete','POST',{parts:[badPart]}),400);
 const cancelled=expect(await req('/api/uploads','POST',{fileName:'cancel.pdf',fileSize:20,fileHash:'1'.repeat(64)}),201);expect(await req('/api/uploads/'+cancelled.id,'DELETE'),200);expect(await req('/api/uploads/'+cancelled.id+'?part=1','PUT',Buffer.alloc(20)),404);
 const elapsedMs=Math.round(performance.now()-started);console.log(JSON.stringify({passed:true,base,bytes:bytes.length,parts:total,elapsedMs,checks:['part bounds','resume/retry part','incomplete completion rejection','idempotent completion','download SHA256','dedup preflight','range bytes','corrupt hash rejection','cancel isolation']}));
 await writeFile('qa/multipart-'+(base.includes(':5173')?'cloud':'local')+'-results.json',JSON.stringify({passed:true,elapsedMs,bytes:bytes.length,parts:total},null,2));
}finally{if(paper)await req('/api/papers/'+paper.id+'?revision='+paper.revision,'DELETE');else await req('/api/uploads/'+upload.id,'DELETE');}
