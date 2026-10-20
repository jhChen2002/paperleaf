import {env} from 'cloudflare:workers';
import {createHash,randomBytes} from 'node:crypto';
import {hashPassword} from 'better-auth/crypto';
import {getAuth,trustedOrigin} from './auth';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {z} from 'zod';
const email=z.string().trim().email().max(254).transform(v=>v.toLowerCase());
const password=z.string().min(12,'密码至少需要 12 位。').max(128,'密码不能超过 128 位。');
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const recoveryCode=()=>randomBytes(20).toString('hex').toUpperCase().match(/.{8}/g)!.join('-');
const codeHash=(code:string)=>digest(code.replace(/[\s-]/g,'').toUpperCase());
class AccountError extends Error {constructor(public status:number,message:string){super(message);}}
async function limit(key:string,max:number,seconds:number){
 const now=Date.now(),expires=now+seconds*1000;
 const row=await env.DB!.prepare('INSERT INTO auth_throttle(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN ? ELSE expires END RETURNING count').bind(digest(key),expires,now,now,expires).first<{count:number}>();
 if(row!.count>max)throw new AccountError(429,'尝试次数较多，请稍后再试。');
 await env.DB!.prepare('DELETE FROM auth_throttle WHERE expires<?').bind(now-86400000).run();
}
async function readBody(request:Request){
 if(!request.headers.get('content-type')?.includes('application/json'))throw new AccountError(415,'请提交 JSON 内容。');
 if(!request.body)throw new AccountError(400,'请求不能为空。');
 const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new AccountError(413,'请求内容过长。');}chunks.push(value);}
 try{return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));}catch{throw new AccountError(400,'请求格式不正确。');}
}
export async function accountRequest(request:Request,action:string){
 try{
  if(request.method==='GET'){
   const session=await getAuth().api.getSession({headers:request.headers});if(!session)throw new AccountError(401,'请先使用邮箱登录。');
   const legacy=await getChatGPTUser();
   const linked=await env.DB!.prepare('SELECT user_id FROM auth_library_link WHERE user_id=?').bind(session.user.id).first();
   const recovery=await env.DB!.prepare('SELECT user_id FROM auth_recovery WHERE user_id=?').bind(session.user.id).first();
   return response({email:session.user.email,name:session.user.name,hasRecovery:!!recovery,legacy:legacy&&!linked?{name:legacy.displayName,email:legacy.email}:null});
  }
  if(!trustedOrigin(request))throw new AccountError(403,'请在纸间网页内完成此操作。');
  const ip=request.headers.get('cf-connecting-ip')||'unknown';await limit('account-ip:'+ip,30,60);
  const input=await readBody(request);
  if(action==='recover'){
   const value=z.object({email,password,recoveryCode:z.string().min(20).max(100)}).parse(input);
   await limit('recover:'+value.email,5,300);
   const account=await env.DB!.prepare('SELECT u.id FROM auth_user u JOIN auth_recovery r ON r.user_id=u.id WHERE u.email=? AND r.code_hash=?').bind(value.email,codeHash(value.recoveryCode)).first<{id:string}>();
   if(!account)throw new AccountError(400,'邮箱或恢复码不正确。');
   const nextCode=recoveryCode(),nextHash=codeHash(nextCode),newHash=await hashPassword(value.password);
   const results=await env.DB!.batch([
    env.DB!.prepare('UPDATE auth_recovery SET code_hash=? WHERE user_id=? AND code_hash=?').bind(nextHash,account.id,codeHash(value.recoveryCode)),
    env.DB!.prepare("UPDATE auth_account SET password=?,updatedAt=? WHERE userId=? AND providerId='credential' AND EXISTS(SELECT 1 FROM auth_recovery WHERE user_id=? AND code_hash=?)").bind(newHash,Date.now(),account.id,account.id,nextHash),
    env.DB!.prepare('DELETE FROM auth_session WHERE userId=? AND EXISTS(SELECT 1 FROM auth_recovery WHERE user_id=? AND code_hash=?)').bind(account.id,account.id,nextHash),
   ]);
   if(results[0].meta.changes!==1)throw new AccountError(409,'恢复码已使用，请使用最新的恢复码。');
   return response({recoveryCode:nextCode,message:'密码已更新，其他设备已退出。请保存新的恢复码，再重新登录。'});
  }
  const session=await getAuth().api.getSession({headers:request.headers});if(!session)throw new AccountError(401,'请先使用邮箱登录。');
  await limit('account-user:'+session.user.id,10,60);
  const value=z.object({password}).parse(input);
  try{await getAuth().api.verifyPassword({headers:request.headers,body:{password:value.password}});}catch{throw new AccountError(400,'当前密码不正确。');}
  if(action==='recovery'){
   const code=recoveryCode();await env.DB!.prepare('INSERT INTO auth_recovery(user_id,code_hash) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash').bind(session.user.id,codeHash(code)).run();
   return response({recoveryCode:code,message:'请保存恢复码。生成新恢复码后，旧码立即失效。'});
  }
  if(action==='link-legacy'){
   const legacy=await getChatGPTUser();if(!legacy)throw new AccountError(401,'请先通过旧版账号入口验证原文献库身份。');
   const existing=await env.DB!.prepare('SELECT legacy_user_id FROM auth_library_link WHERE user_id=?').bind(session.user.id).first<{legacy_user_id:string}>();
   if(existing){if(existing.legacy_user_id===legacy.userId)return response({ok:true});throw new AccountError(409,'此邮箱已经绑定其他文献库。');}
   const owner='email:'+session.user.id;
   try{
    const result=await env.DB!.prepare('INSERT INTO auth_library_link(user_id,legacy_user_id) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM papers WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM folders WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM notes WHERE user_id=?)').bind(session.user.id,legacy.userId,owner,owner,owner).run();
    if(!result.meta.changes)throw new AccountError(409,'当前邮箱库已有内容。为避免覆盖，请先导出备份并使用空的新账号绑定旧库。');
   }catch(e){if(e instanceof AccountError)throw e;throw new AccountError(409,'原文献库已绑定其他邮箱，请使用原邮箱登录。');}
   return response({ok:true,message:'原文献库已绑定。以后使用这个邮箱即可继续阅读。'});
  }
  throw new AccountError(404,'接口不存在。');
 }catch(e){return response({error:e instanceof z.ZodError?e.issues[0].message:e instanceof AccountError?e.message:'操作未完成，请稍后重试。'},e instanceof AccountError?e.status:e instanceof z.ZodError?400:500);}
}
function response(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
