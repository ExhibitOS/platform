import { createRoot } from "react-dom/client";
import { loadStaticPublication } from "./static-publication-source";
import "./style.css";
import {takePrivateView} from './viewer/private-view';
const root=createRoot(document.getElementById("root")!);
let generation=0;
async function load(){
 const current=++generation;
 root.render(<main className="cms-shell"><p role="status">샘플 전시를 준비하고 있어요.</p></main>);
 try{
  const sample=await loadStaticPublication();
  const {privateSeed}=await import('./private-editor/model');
  const seed=privateSeed(sample,document.querySelector<HTMLMetaElement>('meta[name="exhibitos-static-index"]')?.content??'');
  seed.initialView=takePrivateView(sample.publication.id,sample.publication.revisionSha256,seed.indexSha256,sample.exhibition);
  const {PrivateExhibitionEditor}=await import('./PrivateExhibitionEditor');
  if(current===generation)root.render(<PrivateExhibitionEditor key={seed.storeName} seed={seed}/>);
 }catch{if(current===generation)root.render(<main className="cms-shell"><h1>샘플 편집을 열지 못했어요</h1><p role="alert">샘플 파일을 확인할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요. 기존 편집 저장본은 삭제하지 않아요.</p><button onClick={()=>void load()}>다시 시도</button> <a href="/">전시 관람으로 돌아가기</a></main>);}
}
void load();
