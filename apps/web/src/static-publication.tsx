import { createRoot } from "react-dom/client";
import { DynamicConnectionStatus } from "./DynamicConnectionStatus";
import { PublicPublication } from "./PublicPublication";
import { loadStaticPublication } from "./static-publication-source";
import "./style.css";
const root=createRoot(document.getElementById("root")!);
const failed=()=>root.render(<p role="alert">전시 파일을 확인할 수 없어요. 게시 상태와 표시 기한을 확인해 주세요.</p>);
root.render(<p role="status">전시를 여는 중이에요.</p>);
void loadStaticPublication().then(value=>{
 if(value.local&&document.querySelector<HTMLMetaElement>('meta[name="exhibitos-dynamic"]')?.content==="same-origin")value.local.dynamic=true;
 root.render(<>{value.local?.dynamic&&<DynamicConnectionStatus publicationId={value.publication.id} revisionSha256={value.publication.revisionSha256}/>}<PublicPublication id={value.publication.id} initial={value}/></>);
 const expiry=Math.min(...[...value.exhibition.artworks,...value.exhibition.mediaAssets].map(a=>a.rights.expiresAt?Date.parse(a.rights.expiresAt):Infinity));
 const schedule=()=>{if(!Number.isFinite(expiry))return;const remaining=expiry-Date.now();if(remaining<=0){failed();return;}setTimeout(schedule,Math.min(remaining,2147483647));};schedule();
}).catch(failed);
