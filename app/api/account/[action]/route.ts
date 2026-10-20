import {accountRequest} from '../../../../lib/account';
type Context={params:Promise<{action:string}>};
export async function POST(request:Request,{params}:Context){return accountRequest(request,(await params).action);}
export async function GET(request:Request,{params}:Context){const {action}=await params;return action==='security'?accountRequest(request,action):Response.json({error:'接口不存在'},{status:404});}
