import { createRoot } from "react-dom/client";
import { EntranceReadingShell } from "./EntranceReadingShell";
import { DynamicConnectionStatus } from "./DynamicConnectionStatus";
import { PublicPublication } from "./PublicPublication";
import { loadStaticPublication } from "./static-publication-source";
import "./style.css";
import {spaceStillFor} from '@exhibitos/studio-contract';
const bootstrap=document.querySelector('[data-cover-bootstrap]');
const coverTitle=bootstrap?.querySelector('.entrance-paper-left h1')?.textContent??'전시',coverArtist=bootstrap?.querySelector('.entrance-cover-artist')?.textContent;
const coverIntroduction=bootstrap?.querySelector('.entrance-cover-introduction')?.textContent??undefined,coverHasImage=bootstrap?.getAttribute('data-has-image')==='true',coverFolded=bootstrap?.getAttribute('data-paper-state')==='folded',coverRatio=Number(bootstrap?.getAttribute('data-cover-ratio'))||4/3;
const root=createRoot(document.getElementById("root")!);
let generation=0,timer:ReturnType<typeof setTimeout>|undefined;
let firstLoad=true;
function failed(){root.render(<main className="cms-shell"><h1>전시를 열지 못했어요</h1><p role="alert">전시 파일을 확인할 수 없어요. 연결 상태와 게시 상태·표시 기한을 확인한 뒤 다시 시도해 주세요.</p><button onClick={()=>void load()}>다시 시도</button></main>);}
async function load(){
 const current=++generation;
 if(timer!==undefined)clearTimeout(timer);
 // Preserve the actual server-rendered theme while the index is verified.
 // Replacing it with an exhibition-less shell would briefly show catalogue A.
 if(!firstLoad||!bootstrap)root.render(<main className="publication-shell"><EntranceReadingShell title={coverTitle} artist={coverArtist??undefined} introduction={coverIntroduction} hasImage={coverHasImage} folded={coverFolded} ratio={coverRatio} status={<p className="publication-entry-status-quiet" role="status">전시 정보를 확인하고 있어요.</p>}/></main>);firstLoad=false;
 try {
  const value=await loadStaticPublication();
  if(current!==generation)return;
  if(value.local&&document.querySelector<HTMLMetaElement>('meta[name="exhibitos-dynamic"]')?.content==="same-origin")value.local.dynamic=true;
  root.render(<>{value.local?.dynamic&&<DynamicConnectionStatus publicationId={value.publication.id} revisionSha256={value.publication.revisionSha256}/>}<PublicPublication id={value.publication.id} initial={value}/></>);
  const still=spaceStillFor(value.exhibition),expiry=Math.min(...[...value.exhibition.artworks,...value.exhibition.mediaAssets,...(still?[still]:[])].map(a=>a.rights.expiresAt?Date.parse(a.rights.expiresAt):Infinity));
  const schedule=()=>{if(current!==generation||!Number.isFinite(expiry))return;const remaining=expiry-Date.now();if(remaining<=0){failed();return;}timer=setTimeout(schedule,Math.min(remaining,2147483647));};schedule();
 }catch{if(current===generation)failed();}
}
void load();
