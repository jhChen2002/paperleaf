import {getAuth} from '../../../../lib/auth';
async function handle(request:Request){
 if(Number(request.headers.get('content-length')||0)>16384)return Response.json({message:'请求内容过长。'},{status:413});
 if(request.method==='POST'&&request.body){
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();return Response.json({message:'请求内容过长。'},{status:413});}chunks.push(value);}
  // Vinext can supply a Request from a different runtime realm.
  request=new Request(request.url,{method:request.method,headers:request.headers,body:Buffer.concat(chunks)});
 }
 const response=await getAuth().handler(request);response.headers.set('Cache-Control','private, no-store');return response;
}
export const GET=handle;
export const POST=handle;
