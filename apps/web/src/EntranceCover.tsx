// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { entranceFor, MAX_COVER_BYTES,spaceStillFor } from '@exhibitos/studio-contract';
import type { PublicPublication } from './publication-client';
import { fetchVerifiedAsset } from './viewer/loading';
import { waitForCoverLayout } from './cover-ready';
import {validateCoverVariantDescriptor} from './cover-variant-descriptor.mjs';
import {selectCoverVariant} from './cover-variant-selection';
import {entranceRuntime,entranceContent,catalogueStyle} from './entrance-runtime';
import {PosterCover} from './entrance-themes/PosterCover';
import {ArtworkCover} from './entrance-themes/ArtworkCover';
import {InvitationCover} from './entrance-themes/InvitationCover';
import {ThresholdCover} from './entrance-themes/ThresholdCover';
import type {ThemeProps} from './entrance-themes/types';
import './entrance-cover.css';
import './entrance-host.css';

export function coverAspectRatio(publication:Pick<PublicPublication,'exhibition'>){
 const id=entranceFor(publication.exhibition).imageAssetId;
 const work=publication.exhibition.artworks.find(a=>a.assets.some(asset=>asset.id.toLowerCase()===id?.toLowerCase()));
 return work&&work.dimensions.height>0?work.dimensions.width/work.dimensions.height:4/3;
}
/** One verified poster stays mounted across the entry request. It never gates entry. */
export interface EntranceCoverSource {
 /** Host-only authenticated display derivative, never supplied through publication JSON. */
 image(assetId:string,signal:AbortSignal):Promise<ArrayBuffer>;
}
export function EntranceCover({ publication, showImage, interactive = true, motion = true, ticket, children,locale,source,onImageState }: {
  publication: PublicPublication|Pick<PublicPublication,'exhibition'>; showImage: boolean; interactive?: boolean; motion?: boolean; ticket?: ReactNode; children: ReactNode;locale?:string;
  source?:EntranceCoverSource;onImageState?:(status:ThemeProps['image']['status'])=>void;
}) {
  const compact=typeof window!=='undefined'&&window.matchMedia('(max-width:700px)').matches,{settings,design,effects,authored}=entranceRuntime(publication.exhibition,!motion,compact),canReveal=effects.cover!=='none',content=entranceContent(publication.exhibition,locale,compact), generation = useRef(0), spread = useRef<HTMLDivElement>(null);
  const still=spaceStillFor(publication.exhibition),hasUsableImage=!!settings.imageAssetId&&(design.theme!=='threshold'||!!still);
  const [image, setImage] = useState<{url:string;width:number;height:number;generation:number;variant:boolean}|null>(null);
  const [box,setBox]=useState<{key:string;width:number;height:number;pixelRatio:number}|undefined>();
  const [forcePrimary,setForcePrimary]=useState(false);
  const [layoutReady,setLayoutReady]=useState(false);
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [paper, setPaper] = useState<'folded'|'opening'|'open'|'flat'>(()=>showImage&&hasUsableImage&&motion&&canReveal?'folded':'flat');
  const imageStateCallback=useRef(onImageState);imageStateCallback.current=onImageState;
  const displayedImageState:ThemeProps['image']['status']=!showImage||!hasUsableImage?'absent':failed?'failed':image?(loaded?'ready':'decoded'):'loading';
  useEffect(()=>{imageStateCallback.current?.(displayedImageState);},[displayedImageState]);
  // Once left, failed, or explicitly flattened, this revision never folds again.
  useEffect(()=>{
    if(!interactive||!showImage||!hasUsableImage||failed||!motion||!canReveal)setPaper('flat');
    else if(layoutReady)setPaper(state=>state==='folded'?(design.theme==='catalogue'||loaded?'opening':'open'):state);
  },[interactive,showImage,hasUsableImage,failed,motion,canReveal,layoutReady,design.theme,loaded]);
  useEffect(()=>{
    const compact=window.matchMedia('(max-width:700px)'),reduced=window.matchMedia('(prefers-reduced-motion:reduce)');
    const flatten=()=>setPaper('flat'),preference=()=>{if((compact.matches&&(design.theme==='catalogue'||design.effects.mobile==='none'))||reduced.matches)flatten();};
    preference();compact.addEventListener('change',preference);reduced.addEventListener('change',preference);window.addEventListener('resize',flatten);
    return()=>{compact.removeEventListener('change',preference);reduced.removeEventListener('change',preference);window.removeEventListener('resize',flatten);};
  },[design.theme,design.effects.mobile]);
  useEffect(()=>{
    setLayoutReady(false);
    if(!spread.current||!interactive||!motion||!canReveal)return;
    const abort=new AbortController(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(15000)]);
    void waitForCoverLayout(spread.current,signal).then(()=>{if(!signal.aborted)setLayoutReady(true);}).catch(()=>{if(!abort.signal.aborted)setPaper('flat');});
    return()=>abort.abort();
  },[interactive,motion,canReveal]);
  const ratio=coverAspectRatio(publication);
  const trusted=!source&&'publication' in publication&&validateCoverVariantDescriptor(publication),descriptor=trusted&&'coverVariants' in publication?publication.coverVariants:undefined;
  const measureKey='publication' in publication?`${publication.publication.revisionSha256}:${design.theme}`:design.theme;
  useEffect(()=>{setForcePrimary(false);},[publication,settings.imageAssetId]);
  useEffect(()=>{
    const element=spread.current?.querySelector<HTMLElement>('.entrance-theme-image,.entrance-cover-image');
    if(!showImage||!trusted)return;
    if(!element){setBox({key:measureKey,width:0,height:0,pixelRatio:1});return;}
    const measure=()=>{const next={key:measureKey,width:element.offsetWidth,height:element.offsetHeight,pixelRatio:window.devicePixelRatio};setBox(old=>old&&old.key===next.key&&old.width===next.width&&old.height===next.height&&old.pixelRatio===next.pixelRatio?old:next);};
    let density:MediaQueryList|undefined;
    const densityChanged=()=>{measure();watchDensity();};
    const watchDensity=()=>{density?.removeEventListener('change',densityChanged);density=window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);density.addEventListener('change',densityChanged);};
    measure();watchDensity();const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);observer?.observe(element);window.addEventListener('resize',measure);
    return()=>{observer?.disconnect();density?.removeEventListener('change',densityChanged);window.removeEventListener('resize',measure);};
  },[measureKey,showImage,trusted]);
  const measured=box?.key===measureKey?box:undefined;
  const selected=descriptor&&measured&&!forcePrimary?selectCoverVariant(descriptor.primary,descriptor.variants.map(v=>({...v,id:v.assetId})),{...measured,fit:design.image.fit}):undefined;
  useEffect(() => {
    const current=++generation.current, abort = new AbortController();
    let objectURL = '';
    setImage(null); setLoaded(false); setFailed(false);
    if (!showImage || !hasUsableImage || !settings.imageAssetId) return;
    if(trusted&&!measured)return;
    const id=settings.imageAssetId.toLowerCase(),selectedId=selected?.id??id,deadline=AbortSignal.timeout(15000);
    const load=async(target:string)=>{
      const signal=AbortSignal.any([abort.signal,deadline,...(target.toLowerCase()===id?[]:[AbortSignal.timeout(5000)])]),inventory=publication.exhibition.artworks.flatMap(a=>a.assets).find(a=>a.id.toLowerCase()===target.toLowerCase())??(still?.id.toLowerCase()===target.toLowerCase()?still:undefined);
      const asset='assets' in publication?publication.assets.find(a=>a.assetId.toLowerCase()===target.toLowerCase()):undefined;
      if(!inventory||!source&&(!asset||!('publication' in publication)))throw Error('COVER_SOURCE_UNAVAILABLE');
      const bytes=source?await source.image(id,signal):'publication' in publication&&asset?await fetchVerifiedAsset({publicationId:publication.publication.id,revisionSha256:publication.publication.revisionSha256,inventory,asset,signal,...publication.local,maxBytes:MAX_COVER_BYTES}):(()=>{throw Error('COVER_SOURCE_UNAVAILABLE');})();
      signal.throwIfAborted();
      if(bytes.byteLength>MAX_COVER_BYTES)throw Error('COVER_PNG_LIMIT');
      const view = new DataView(bytes), signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (bytes.byteLength < 33 || signature.some((n, i) => view.getUint8(i) !== n) || view.getUint32(8) !== 13 ||
          view.getUint32(12) !== 0x49484452 || view.getUint32(16) < 1 || view.getUint32(20) < 1 ||
          view.getUint32(16) > 4096 || view.getUint32(20) > 4096 || selected&&target===selected.id&&(view.getUint32(16)!==selected.width||view.getUint32(20)!==selected.height)) throw Error('COVER_PNG_LIMIT');
      if(current!==generation.current)return;
      objectURL = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const decoded = new Image(); decoded.src = objectURL;
      await new Promise<void>((resolve,reject)=>{
        const stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});
        void decoded.decode().then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
        if(signal.aborted)stop();
      }); signal.throwIfAborted();
      if(current!==generation.current)return;
      setImage({url:objectURL,width:view.getUint32(16),height:view.getUint32(20),generation:current,variant:target.toLowerCase()!==id});
    };
    void (async()=>{try{await load(selectedId);}catch(error){
      if(objectURL){URL.revokeObjectURL(objectURL);objectURL='';}
      abort.signal.throwIfAborted();deadline.throwIfAborted();if(selectedId.toLowerCase()===id)throw error;
      await load(id);
    }})().catch(() => { if(objectURL)URL.revokeObjectURL(objectURL);if (!abort.signal.aborted&&current===generation.current) setFailed(true); });
    return () => { abort.abort(); if(current===generation.current)generation.current++;if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [publication, showImage, settings.imageAssetId, hasUsableImage,retry,source,trusted,!!measured,selected?.id]);
  const displayed=()=>{if(image?.generation===generation.current)requestAnimationFrame(()=>{if(image.generation===generation.current)setLoaded(true);});};
  const imageFailed=()=>{if(image?.generation===generation.current){if(image.variant)setForcePrimary(true);else setFailed(true);}};
  const phase=paper;
  if(design.theme!=='catalogue'){
    const Component={poster:PosterCover,artwork:ArtworkCover,invitation:InvitationCover,threshold:ThresholdCover}[design.theme];
    const status=displayedImageState;
    const props:ThemeProps={content,image:{status,url:image?.url,width:image?.width,height:image?.height,layoutRatio:ratio},design:{...design,effects},coverState:phase==='folded'?'pending':phase==='opening'?'revealing':phase,interactive,reducedMotion:!motion,layoutRef:spread,entry:ticket,children,onImageLoad:displayed,onImageError:imageFailed,onRetryImage:()=>setRetry(n=>n+1)};
    return <div className="entrance-theme-host" lang={content.locale} onAnimationEnd={event=>{if(['entrance-theme-mask','entrance-theme-fade','entrance-theme-card'].includes(event.animationName))setPaper(state=>state==='opening'||state==='folded'?'open':state);}}><Component {...props}/></div>;
  }
  const style=catalogueStyle(design,authored,effects);
  const copy=<><h1>{content.title}</h1>
    {content.artist&&<p className="entrance-cover-artist">{content.artist}</p>}
    {content.introduction&&<p className="entrance-cover-introduction">{content.introduction}</p>}</>;
  return <section className="entrance-cover" style={style} lang={content.locale} aria-label="전시 표지" data-image-position={settings.mobilePosition} data-has-image={Boolean(showImage&&settings.imageAssetId)} data-paper-state={phase}>
    <div className="entrance-cover-spread" ref={spread}>
      <div className="entrance-cover-copy entrance-paper-left"><div className="entrance-cover-prose">{copy}</div>{ticket&&<div className="entrance-paper-ticket-slot">{ticket}</div>}</div>
      {showImage&&settings.imageAssetId&&<div className="entrance-paper-leaf" style={{aspectRatio:String(ratio)}} onAnimationEnd={event=>{if(event.animationName==='cover-paper-right')setPaper(state=>state==='opening'?'open':state);}}>
        <div className="entrance-paper-outside entrance-cover-copy" aria-hidden="true">{copy}</div>
        <div className="entrance-cover-image entrance-paper-inside" aria-busy={!loaded&&!failed} data-image-state={failed?'failed':loaded?'ready':'loading'}>
          {image&&!failed&&<img key={image.url} src={image.url} width={image.width} height={image.height} alt={settings.imageAlt} decoding="async" onLoad={displayed} onError={imageFailed}/>}
          {failed&&<div className="entrance-cover-image-failure"><p role="status">표지를 불러오지 못했어요. 입장과 글 관람은 이용할 수 있어요.</p><button onClick={()=>setRetry(n=>n+1)}>표지 다시 불러오기</button></div>}
        </div>
      </div>}
    </div>
    <div className="entrance-cover-actions">{children}</div>
  </section>;
}
