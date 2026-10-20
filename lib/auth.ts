import {env} from 'cloudflare:workers';
import {betterAuth} from 'better-auth/minimal';
import {drizzleAdapter} from 'better-auth/adapters/drizzle';
import {drizzle} from 'drizzle-orm/d1';
import {authUser,authSession,authAccount,authVerification,authRateLimit} from '../db/schema';

let instance:ReturnType<typeof createAuth>|undefined;
function createAuth(){
 if(!env.DB||!env.BETTER_AUTH_SECRET||!env.BETTER_AUTH_URL)throw new Error('Email sign-in is not configured.');
 return betterAuth({
  appName:'纸间 Paperleaf',baseURL:env.BETTER_AUTH_URL,secret:env.BETTER_AUTH_SECRET,
  database:drizzleAdapter(drizzle(env.DB),{provider:'sqlite',schema:{user:authUser,session:authSession,account:authAccount,verification:authVerification,rateLimit:authRateLimit}}),
  emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,requireEmailVerification:false,revokeSessionsOnPasswordReset:true},
  session:{expiresIn:60*60*24*30,updateAge:60*60*24,cookieCache:{enabled:false}},
  account:{accountLinking:{enabled:false}},
  rateLimit:{enabled:true,storage:'database',window:60,max:60,customRules:{'/sign-up/email':{window:600,max:10},'/sign-in/email':{window:60,max:10},'/get-session':false}},
  advanced:{cookiePrefix:'paperleaf',ipAddress:{ipAddressHeaders:['cf-connecting-ip']}},
 });
}
export function getAuth(){return instance??=createAuth();}
export function trustedOrigin(request:Request){
 const origin=request.headers.get('origin');
 return request.headers.get('sec-fetch-site')!=='cross-site'&&origin===new URL(env.BETTER_AUTH_URL!).origin;
}
