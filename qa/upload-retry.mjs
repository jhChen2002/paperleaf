import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(import.meta.url),esbuild=require(require.resolve('esbuild',{paths:[path.dirname(require.resolve('vite/package.json'))]}));
await esbuild.build({entryPoints:['lib/pdf-upload.ts'],outfile:'work/pdf-upload-test.mjs',bundle:true,platform:'node',format:'esm'});
const base=process.env.PAPERLEAF_TEST_URL||'http://127.0.0.1:43128',headers=base.includes(':5173')?{Cookie:'__sites_local_auth=1'}:{},counts=new Map();let lost=false;
globalThis.XMLHttpRequest=class{
 upload={};response=null;status=0;controller=new AbortController();aborted=false;
 open(method,url){this.method=method;this.url=url;}setRequestHeader(){}abort(){this.aborted=true;this.controller.abort();this.onabort?.();}
 send(body){const part=new URL(this.url,base).searchParams.get('part');if(part)counts.set(part,(counts.get(part)||0)+1);
  void fetch(base+this.url,{method:this.method,body,headers:{...headers,'Content-Type':body instanceof Blob?'application/octet-stream':'application/json'},signal:this.controller.signal}).then(async response=>{
   this.status=response.status;this.response=await response.json();if(this.aborted)return;
   if(part==='1'&&!lost){lost=true;this.onerror?.();return;}
   this.upload.onprogress?.({loaded:body instanceof Blob?body.size:String(body).length});
   if(!this.aborted)this.onload?.();
  }).catch(()=>{if(!this.aborted)this.onerror?.();});
 }
};
const {uploadPdf}=await import('../work/pdf-upload-test.mjs');
const file=new File([await readFile('qa/continuous-20mb.pdf'),'\n% retry '+Date.now()],'retry-test.pdf',{type:'application/pdf'});let stop=new AbortController(),paused=false;
try{await uploadPdf(file,{signal:stop.signal,onProgress:(n,phase)=>{if(phase==='上传分块 2/5'){stop.abort();}}});}catch(e){assert.equal(e.name,'AbortError');paused=true;}
assert.ok(paused);assert.equal(counts.get('1'),2);const before=counts.get('1');
const result=await uploadPdf(file,{signal:new AbortController().signal,onProgress:()=>{}});assert.equal(counts.get('1'),before);assert.ok(counts.get('2')>=2);assert.equal(result.paper.fileSize,file.size);
await fetch(base+'/api/papers/'+result.paper.id+'?revision='+result.paper.revision,{method:'DELETE',headers});
const report={passed:true,checks:['lost server response automatically retried','pause interrupted an active part','resume preserved completed parts','upload completed without duplicated paper'],requests:Object.fromEntries(counts)};await writeFile('qa/upload-retry-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
