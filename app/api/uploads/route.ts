import {api,startUpload} from '@/lib/server';
export const dynamic='force-dynamic';
export async function POST(request:Request){return api(()=>startUpload(request));}
