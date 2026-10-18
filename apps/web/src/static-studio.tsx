import { createRoot } from "react-dom/client";
import { loadStaticPublication } from "./static-publication-source";
import "./style.css";
const root=createRoot(document.getElementById("root")!);
const sampleRevision="4a561248e1f166dfb3ca2ea4cfb692127e1e533440ce0c8a7aba1df069b58f00";
let generation=0;
async function load(){
 const current=++generation;
 root.render(<main className="cms-shell"><p role="status">샘플 전시를 준비하고 있어요.</p></main>);
 try{
  const sample=await loadStaticPublication();
  if(sample.publication.revisionSha256!==sampleRevision||!sample.local||[...sample.exhibition.artworks,...sample.exhibition.mediaAssets].some(item=>item.rights.licenseId!=="CC0-1.0"))throw Error("DEMO_SAMPLE");
  const {Studio}=await import("./Studio");
  if(current===generation)root.render(<Studio demo={sample}/>);
 }catch{if(current===generation)root.render(<main className="cms-shell"><h1>샘플 편집을 열지 못했어요</h1><p role="alert">샘플 파일을 확인할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요. 기존 편집 저장본은 삭제하지 않아요.</p><button onClick={()=>void load()}>다시 시도</button> <a href="/">전시 관람으로 돌아가기</a></main>);}
}
void load();
