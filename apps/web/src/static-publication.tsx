import { createRoot } from "react-dom/client";
import { DynamicConnectionStatus } from "./DynamicConnectionStatus";
import { PublicPublication } from "./PublicPublication";
import { loadStaticPublication } from "./static-publication-source";
import "./style.css";
const root=createRoot(document.getElementById("root")!);
let generation=0,timer:ReturnType<typeof setTimeout>|undefined;
function failed(){root.render(<main className="cms-shell"><h1>전시를 열지 못했어요</h1><p role="alert">전시 파일을 확인할 수 없어요. 연결 상태와 게시 상태·표시 기한을 확인한 뒤 다시 시도해 주세요.</p><button onClick={()=>void load()}>다시 시도</button></main>);}
async function load(){
 const current=++generation;
 if(timer!==undefined)clearTimeout(timer);
 root.render(<p role="status">전시를 준비하고 있어요.</p>);
 try {
  const value=await loadStaticPublication();
  if(current!==generation)return;
  if(value.local&&document.querySelector<HTMLMetaElement>('meta[name="exhibitos-dynamic"]')?.content==="same-origin")value.local.dynamic=true;
  root.render(<>{value.local?.dynamic&&<DynamicConnectionStatus publicationId={value.publication.id} revisionSha256={value.publication.revisionSha256}/>}<PublicPublication id={value.publication.id} initial={value}/></>);
  const expiry=Math.min(...[...value.exhibition.artworks,...value.exhibition.mediaAssets].map(a=>a.rights.expiresAt?Date.parse(a.rights.expiresAt):Infinity));
  const schedule=()=>{if(current!==generation||!Number.isFinite(expiry))return;const remaining=expiry-Date.now();if(remaining<=0){failed();return;}timer=setTimeout(schedule,Math.min(remaining,2147483647));};schedule();
 }catch{if(current===generation)failed();}
}
void load();
