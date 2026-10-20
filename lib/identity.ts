import {headers} from 'next/headers';
import {env} from 'cloudflare:workers';
import {getAuth} from './auth';
import {getChatGPTUser} from '../app/chatgpt-auth';
export async function getCurrentUser(){
 const h=await headers();
 const origin=h.get('origin');
 if(h.get('sec-fetch-site')==='cross-site'||(origin&&origin!==new URL(env.BETTER_AUTH_URL!).origin))return null;
 const session=await getAuth().api.getSession({headers:h});
 if(session){
  const link=await env.DB!.prepare('SELECT legacy_user_id FROM auth_library_link WHERE user_id=?').bind(session.user.id).first<{legacy_user_id:string}>();
  const legacy=await getChatGPTUser();
  return {userId:link?.legacy_user_id||'email:'+session.user.id,displayName:session.user.name,email:session.user.email,fullName:session.user.name,authType:'email',legacyAvailable:!!legacy&&!link,legacySignedIn:!!legacy};
 }
 if(/(?:^|;\s*)(?:__Secure-)?paperleaf\.session_token=/.test(h.get('cookie')||''))return null;
 const legacy=await getChatGPTUser();return legacy?{...legacy,authType:'legacy',legacyAvailable:true,legacySignedIn:true}:null;
}
