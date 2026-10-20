import {api,finishUpload} from '@/lib/server';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return api(()=>finishUpload(request,context));}
