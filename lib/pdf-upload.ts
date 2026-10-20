import type {Paper} from './types';
import {rememberPdf,paperFileUrl} from './pdf-source-cache';
type Session={id:string;partSize:number;parts:{partNumber:number;etag:string}[]};
type Options={folderId?:string;paperId?:string;revision?:number;signal:AbortSignal;onProgress:(loaded:number,phase:string)=>void};
const sessions=new WeakMap<File,Session>();const hashes=new WeakMap<File,string>();
class UploadError extends Error{constructor(message:string,public retryable=false,public resetSession=false){super(message);}}
function send<T>(url:string,method:string,body:Blob|Record<string,unknown>,options:Options,onBytes?:(n:number)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open(method,url);xhr.timeout=180000;xhr.responseType='json';
  const abort=()=>xhr.abort();const cleanup=()=>options.signal.removeEventListener('abort',abort);
  xhr.upload.onprogress=e=>onBytes?.(e.loaded);
  xhr.onerror=()=>{cleanup();reject(new UploadError('网络连接中断，可以继续重试。',true));};
  xhr.ontimeout=()=>{cleanup();reject(new UploadError('这一分块传输超时，可以继续重试。',true));};
  xhr.onabort=()=>{cleanup();reject(new DOMException('上传已暂停','AbortError'));};
  xhr.onload=()=>{cleanup();const result=xhr.response;if(xhr.status>=200&&xhr.status<300&&result)resolve(result);else reject(new UploadError(result?.error||({200:'登录信息可能已失效，请刷新页面重新登录。',401:'登录已失效，请重新登录后再导入。',413:'服务暂时无法接收这一分块，请稍后重试。'}[xhr.status]||`上传未完成（${xhr.status}），请重试。`),xhr.status===0||xhr.status===408||xhr.status===429||xhr.status>=500,xhr.status===404||xhr.status===410||['FILE_HASH_MISMATCH','FILE_SIZE_MISMATCH','REVISION_CONFLICT','DUPLICATE_FILE','UPLOAD_SUPERSEDED'].includes(result?.code)));};
  options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted){cleanup();reject(new DOMException('上传已暂停','AbortError'));return;}
  xhr.setRequestHeader('Content-Type',body instanceof Blob?'application/octet-stream':'application/json');xhr.send(body instanceof Blob?body:JSON.stringify(body));
 });
}
async function retry<T>(work:()=>Promise<T>,options:Options):Promise<T>{for(let attempt=0;;attempt++){if(options.signal.aborted)throw new DOMException('上传已暂停','AbortError');try{return await work();}catch(e){if(!(e instanceof UploadError)||!e.retryable||attempt>=2)throw e;await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));}}}
export async function uploadPdf(file:File,options:Options):Promise<{paper:Paper;duplicate?:boolean}>{
 if(file.size<5||file.size>40*1024*1024)throw new Error('请选择非空且不超过 40 MB 的 PDF。');
 if(await file.slice(0,5).text()!=='%PDF-')throw new Error('文件内容不是有效的 PDF。');
 options.onProgress(0,'校验文件');let hash=hashes.get(file);
 if(!hash){hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');hashes.set(file,hash);}
 let session=sessions.get(file);
 if(!session){const created=await retry(()=>send<Session&{paper?:Paper;duplicate?:boolean}>('/api/uploads','POST',{fileName:file.name,fileSize:file.size,fileHash:hash,folderId:options.folderId||null,paperId:options.paperId,revision:options.revision},options),options);
  if(created.paper){rememberPdf(paperFileUrl(created.paper),file);return {paper:created.paper,duplicate:created.duplicate};}
  session={id:created.id,partSize:created.partSize,parts:[]};sessions.set(file,session);
 }
 const state=session;let completed=state.parts.reduce((n,p)=>n+Math.min(state.partSize,file.size-(p.partNumber-1)*state.partSize),0);
 try{for(let partNumber=1;partNumber<=Math.ceil(file.size/state.partSize);partNumber++){
  if(state.parts.some(p=>p.partNumber===partNumber))continue;
  const chunk=file.slice((partNumber-1)*state.partSize,partNumber*state.partSize);
  const result=await retry(()=>send<{partNumber:number;etag:string}>(`/api/uploads/${state.id}?part=${partNumber}`,'PUT',chunk,options,n=>options.onProgress(Math.min(file.size,completed+n),`上传分块 ${partNumber}/${Math.ceil(file.size/state.partSize)}`)),options);
  state.parts.push(result);completed+=chunk.size;options.onProgress(completed,'分块已保存');
 }
 options.onProgress(file.size,'校验并保存');
 const result=await retry(()=>send<{paper:Paper}>(`/api/uploads/${state.id}/complete`,'POST',{parts:state.parts},options),options);
 rememberPdf(paperFileUrl(result.paper),file);sessions.delete(file);return result;
 }catch(error){if(error instanceof UploadError&&error.resetSession)sessions.delete(file);throw error;}
}
