export async function readBoundedBody(request:Request,maximum:number):Promise<string|null>{
 if(Number(request.headers.get('content-length'))>maximum)return null;
 const reader=request.body?.getReader();if(!reader)return '';const chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maximum){await reader.cancel();return null;}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
