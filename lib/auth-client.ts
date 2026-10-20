export async function authRequest(path:string,body?:unknown){
 const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,credentials:'same-origin',cache:'no-store',body:body?JSON.stringify(body):undefined});
 const value=await response.json().catch(()=>({})) as {error?:string;code?:string;message?:string;recoveryCode?:string};
 if(!response.ok){
  const errors:Record<string,string>={INVALID_EMAIL_OR_PASSWORD:'邮箱或密码不正确。',USER_ALREADY_EXISTS:'这个邮箱已注册，请直接登录。',USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:'这个邮箱已注册，请直接登录。',PASSWORD_TOO_SHORT:'密码至少需要 12 位。',INVALID_PASSWORD:'当前密码不正确。',SESSION_EXPIRED:'登录已过期，请重新登录。',INVALID_ORIGIN:'请从当前纸间网址重新打开登录页。'};
  throw new Error(response.status===429?'尝试次数较多，请稍后再试。':value.error||errors[value.code||'']||'操作未完成，请检查输入或稍后重试。');
 }
 if(['/api/auth/sign-in/email','/api/auth/sign-up/email','/api/auth/sign-out'].includes(path)){try{localStorage.setItem('paperleaf-auth-change',Date.now()+':'+Math.random());}catch{}}
 return value;
}
export function downloadRecovery(email:string,code:string){
 const body=`纸间 Paperleaf 账号恢复码\n\n网址：${location.origin}\n账号：${email}\n恢复码：${code}\n\n请妥善保管，不要分享。此码可用于重置密码。生成新码或成功恢复账号后旧码失效。\n`;
 const url=URL.createObjectURL(new Blob([body],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='纸间-账号恢复码.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
