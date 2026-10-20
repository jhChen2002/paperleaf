import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:5173',stamp=Date.now(),checks=[],password='Paperleaf-QA-'+randomUUID();
const emails=[`qa-email-a-${stamp}@example.test`,`qa-email-b-${stamp}@example.test`,`qa-email-c-${stamp}@example.test`];
function client(extra={}){const cookies=new Map();return {cookies,async request(path,method='GET',body,headers={}){
 const response=await fetch(base+path,{method,headers:{Origin:base,...extra,...headers,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')+(headers.Cookie?'; '+headers.Cookie:''),...body?{'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json'}:{}},body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined,redirect:'manual'});
 for(const cookie of response.headers.getSetCookie()){const [part]=cookie.split(';');const [key,...value]=part.split('=');if(value.join('='))cookies.set(key,value.join('='));else cookies.delete(key);}
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data={message:raw.slice(0,200)}}return {status:response.status,data,headers:response.headers};
 }};}
function expected(r,status){assert.equal(r.status,status,String(r.data.error||r.data.message||r.data.code||'Unexpected response'));return r.data;}
function pass(s){checks.push(s);console.log('PASS '+s);}
const a=client(),b=client(),a2=client(),anonymous=client(),legacy=client(),c=client();
expected(await anonymous.request('/api/library'),401);
for(const [user,email] of [[a,emails[0]],[b,emails[1]]])expected(await user.request('/api/auth/sign-up/email','POST',{email,name:'QA researcher',password}),200);
assert.ok([...a.cookies.keys()].some(k=>k.includes('session_token')));pass('Email registration creates independent sessions without ChatGPT');
const libA=expected(await a.request('/api/library'),200),libB=expected(await b.request('/api/library'),200);assert.equal(libA.papers.length,0);assert.equal(libB.papers.length,0);
expected(await anonymous.request('/api/auth/sign-up/email','POST',{email:`csrf-${stamp}@example.test`,name:'CSRF',password},{Origin:'https://unrelated.example'}),403);
expected(await a.request('/api/library','GET',undefined,{'Sec-Fetch-Site':'cross-site'}),401);pass('Unauthenticated and cross-site requests rejected');
const bytes=Buffer.from(`%PDF-1.4\n% email-auth-${stamp}\n%%EOF`),hash=createHash('sha256').update(bytes).digest('hex');
const upload=expected(await a.request('/api/uploads','POST',{fileName:'email-test.pdf',fileSize:bytes.length,fileHash:hash}),201);
for(const [path,method,body] of [[`/api/uploads/${upload.id}?part=1`,'PUT',bytes],[`/api/uploads/${upload.id}/complete`,'POST',{parts:[]}],[`/api/uploads/${upload.id}`,'DELETE']])expected(await b.request(path,method,body),404);
const part=expected(await a.request(`/api/uploads/${upload.id}?part=1`,'PUT',bytes),200);
let paper=expected(await a.request(`/api/uploads/${upload.id}/complete`,'POST',{parts:[part]}),200).paper;
const folder=expected(await a.request('/api/folders','POST',{name:'QA methods'}),201).folder;
paper=expected(await a.request(`/api/papers/${paper.id}`,'PATCH',{folderId:folder.id,pageCount:5,currentPage:3,status:'reading',revision:paper.revision}),200).paper;
const note=expected(await a.request('/api/notes','POST',{paperId:paper.id,content:'My private idea',quote:'Useful finding',page:3}),201).note;
expected(await a2.request('/api/auth/sign-in/email','POST',{email:emails[0],password}),200);
const second=expected(await a2.request('/api/library'),200);assert.equal(second.papers[0].id,paper.id);assert.equal(second.papers[0].currentPage,3);assert.equal(second.notes[0].content,note.content);pass('Second device sees the same PDFs, notes, folders and reading position');
for(const [path,method,body] of [[`/api/papers/${paper.id}/file`,'GET'],[`/api/papers/${paper.id}`,'PATCH',{title:'Wrong owner',revision:paper.revision}],[`/api/papers/${paper.id}?revision=${paper.revision}`,'DELETE'],[`/api/notes/${note.id}`,'PATCH',{content:'Wrong owner',revision:1}],[`/api/folders/${folder.id}`,'DELETE'],['/api/notes','POST',{paperId:paper.id,content:'Wrong owner'}],['/api/papers','POST',{title:'Wrong owner',folderId:folder.id}]])expected(await b.request(path,method,body),404);
assert.equal(expected(await b.request('/api/library'),200).papers.length,0);assert.ok(!JSON.stringify(expected(await b.request('/api/export'),200)).includes(paper.id));pass('Account B cannot read, edit, delete, reference, export or complete account A data');
const bUpload=expected(await b.request('/api/uploads','POST',{fileName:'same.pdf',fileSize:bytes.length,fileHash:hash}),201);assert.ok(bUpload.id!==upload.id);expected(await b.request(`/api/uploads/${bUpload.id}`,'DELETE'),200);pass('File deduplication does not reveal another user library');
const edits=await Promise.all([a.request(`/api/papers/${paper.id}`,'PATCH',{title:'Device A',revision:paper.revision}),a2.request(`/api/papers/${paper.id}`,'PATCH',{title:'Device B',revision:paper.revision})]);assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);paper=edits.find(r=>r.status===200).data.paper;pass('Concurrent device edits keep revision conflict protection');
const recovery=expected(await a.request('/api/account/recovery','POST',{password}),200).recoveryCode;
expected(await a.request('/api/auth/sign-out','POST',{}),200);expected(await a.request('/api/library'),401);expected(await a2.request('/api/library'),200);pass('Sign-out invalidates only the current device session');
const newPassword='Reset-QA-'+randomUUID();const reset=expected(await anonymous.request('/api/account/recover','POST',{email:emails[0],password:newPassword,recoveryCode:recovery}),200);assert.notEqual(reset.recoveryCode,recovery);
expected(await a2.request('/api/library'),401);expected(await a.request('/api/auth/sign-in/email','POST',{email:emails[0],password}),401);expected(await a.request('/api/auth/sign-in/email','POST',{email:emails[0],password:newPassword}),200);
expected(await anonymous.request('/api/account/recover','POST',{email:emails[0],password:newPassword,recoveryCode:recovery}),400);assert.equal(expected(await a.request('/api/library'),200).notes[0].id,note.id);pass('Recovery code rotates, revokes old sessions and passwords, preserves the library');
const old=expected(await legacy.request('/api/papers','POST',{title:'QA old library '+stamp},{Cookie:'__sites_local_auth=1'}),201).paper;
expected(await c.request('/api/auth/sign-up/email','POST',{email:emails[2],name:'QA migration',password}),200);assert.equal(expected(await c.request('/api/library'),200).papers.length,0);
expected(await c.request('/api/account/link-legacy','POST',{password}),401);
expected(await c.request('/api/account/link-legacy','POST',{password},{Cookie:'__sites_local_auth=1'}),200);
assert.ok(expected(await c.request('/api/library'),200).papers.some(p=>p.id===old.id));pass('Legacy linking requires both authenticated accounts and preserves the original library');
await a.request(`/api/papers/${paper.id}?revision=${paper.revision}`,'DELETE');await a.request(`/api/folders/${folder.id}`,'DELETE');await legacy.request(`/api/papers/${old.id}?revision=${old.revision}`,'DELETE',undefined,{Cookie:'__sites_local_auth=1'});
await writeFile('qa/email-auth-results.json',JSON.stringify({passed:true,testedAt:new Date().toISOString(),checks,testEmails:emails},null,2));
console.log('PASS '+checks.length+' email account and multi-device groups');
