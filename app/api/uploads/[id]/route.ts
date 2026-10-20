import {api,uploadPart,cancelUpload} from '@/lib/server';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function PUT(request:Request,context:Context){return api(()=>uploadPart(request,context));}
export async function DELETE(request:Request,context:Context){return api(()=>cancelUpload(request,context));}
