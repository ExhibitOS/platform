import { createRoot } from "react-dom/client";
import { loadStaticPublication } from "./static-publication-source";
import "./style.css";
import {hasPreviousCopy, previousBases, type PreviousBase} from './private-editor/previous-bases';
import {copyRightsFingerprint} from './private-editor/previous-copy-rights';
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
  const bases=previousBases(document.querySelector<HTMLMetaElement>('meta[name="exhibitos-private-copy-bases"]')?.content,seed);
  const requested=new URLSearchParams(location.search).get('base');
  async function priorSeed(base: PreviousBase) {
    const previous=await loadStaticPublication(base.indexSha256);
    if(previous.publication.id!==base.publicationId||previous.publication.revisionSha256!==base.revisionSha256)throw Error('PRIVATE_COPY_BASE');
    // Previous metadata does not authorize any asset missing from the current baseline.
    if(copyRightsFingerprint(previous.exhibition)!==copyRightsFingerprint(sample.exhibition))throw Error("PRIVATE_COPY_RIGHTS");
    return {...privateSeed(previous,base.indexSha256),existingOnly:true,catalogueBase:seed};
  }
  const copies=await Promise.all(bases.map(async base=>{
    try{
      if(!await hasPreviousCopy(base))return {base,status:'empty'} as const;
    }catch{return {base,status:'unknown'} as const;}
    if(requested&&requested!==base.indexSha256)return {base,status:'saved'} as const;
    try{return {base,status:'saved',seed:await priorSeed(base)} as const;}
    catch{return {base,status:'unavailable'} as const;}
  }));
  const available=copies.filter(copy=>copy.status!=='empty');
  if(current!==generation)return;
  if(!requested&&available.length){
    root.render(<main className="cms-shell">
      <h1>직접 꾸며보기</h1>
      <p>이전 사본은 저장했을 때의 전시를 기준으로 열립니다.</p>
      <ul>{available.map(({base,status})=><li key={base.indexSha256}>
        <span>기준 버전 {base.revisionSha256.slice(0,12)} </span>
        {status==='saved'?<a href={`?base=${base.indexSha256}`}>이전 사본 이어가기</a>:
          <span>{status==='unknown'?'저장 상태를 확인할 수 없어요.':'사본은 저장되어 있지만 기준 버전을 열 수 없어요.'}</span>}
      </li>)}</ul>
      <a href="?base=latest">최신 공개본으로 꾸미기</a>
    </main>);
    return;
  }
  let editingSeed=seed;
  if(requested&&requested!=='latest'){
    const selected=copies.find(item=>item.base.indexSha256===requested);
    if(!selected||!('seed' in selected)||!selected.seed){
      root.render(<main className="cms-shell"><h1>이전 사본을 열 수 없어요</h1>
        <p>기준 버전이나 공개 자산을 확인할 수 없어요. 기존 사본은 이 브라우저에 보관됩니다.</p>
        <a href="studio.html">사본 선택으로 돌아가기</a> <a href="?base=latest">최신 공개본으로 꾸미기</a>
      </main>);
      return;
    }
    editingSeed=selected.seed;
  }else{
    seed.initialView=takePrivateView(sample.publication.id,sample.publication.revisionSha256,seed.indexSha256,sample.exhibition);
  }
  const {PrivateExhibitionEditor}=await import('./PrivateExhibitionEditor');
  if(current===generation)root.render(<>
    {available.length>0&&<nav aria-label="개인 사본 기준">
      <a href="studio.html">사본 기준 선택</a>
      {editingSeed.existingOnly&&<span> 이전 기준 버전 {editingSeed.source.publication.revisionSha256.slice(0,12)}</span>}
    </nav>}
    <PrivateExhibitionEditor key={editingSeed.storeName} seed={editingSeed}/>
  </>);
 }catch{if(current===generation)root.render(<main className="cms-shell"><h1>샘플 편집을 열지 못했어요</h1><p role="alert">샘플 파일을 확인할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요. 기존 편집 저장본은 삭제하지 않아요.</p><button onClick={()=>void load()}>다시 시도</button> <a href="/">전시 관람으로 돌아가기</a></main>);}
}
void load();
