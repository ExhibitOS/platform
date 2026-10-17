import {useEffect,useState} from "react";
async function boundedJSON(path:string,limit:number,signal:AbortSignal):Promise<unknown>{
 const response=await fetch(path,{credentials:"omit",redirect:"error",cache:"no-store",signal});if(!response.ok||!response.body)throw Error("CONNECTION_UNAVAILABLE");
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error("CONNECTION_SIZE");chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
/** Optional read-only connectivity. It never joins presence, opening, voice or account sessions. */
export function DynamicConnectionStatus({publicationId,revisionSha256}:{publicationId:string;revisionSha256:string}){
 const [attempt,setAttempt]=useState(0),[state,setState]=useState<"checking"|"connected"|"unavailable">("checking");
 useEffect(()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);let current=true;setState("checking");
  void(async()=>{const health=await boundedJSON("/api/v1/health",16384,controller.signal) as {status?:string;service?:string};if(health?.status!=="ok"||health.service!=="exhibitos-api")throw Error("CONNECTION_HEALTH");
   const value=await boundedJSON(`/api/v1/publications/${encodeURIComponent(publicationId)}`,1048576,controller.signal) as {publication?:{id?:string;revisionSha256?:string;status?:string}};
   if(value?.publication?.id!==publicationId||value.publication.revisionSha256!==revisionSha256||value.publication.status!=="published")throw Error("CONNECTION_REVISION");if(current)setState("connected");
  })().catch(()=>{if(current)setState("unavailable");}).finally(()=>clearTimeout(timer));
  return()=>{current=false;clearTimeout(timer);controller.abort();};
 },[publicationId,revisionSha256,attempt]);
 return <aside aria-label="추가 연결 상태" className="cms-note"><p role="status" data-testid="static-dynamic-state" data-state={state}>{state==="checking"?"전시 정보 연결을 확인하고 있어요.":state==="connected"?"공개된 전시 정보와 연결됐어요.":"추가 연결을 확인하지 못했어요. 전시는 계속 볼 수 있어요."}</p><button disabled={state==="checking"} onClick={()=>setAttempt(v=>v+1)}>연결 다시 확인</button></aside>;
}
