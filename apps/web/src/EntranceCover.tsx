// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { entranceFor, MAX_COVER_BYTES } from '@exhibitos/studio-contract';
import type { PublicPublication } from './publication-client';
import { fetchVerifiedAsset } from './viewer/loading';
import './entrance-cover.css';

/** One verified poster stays mounted across the entry request. It never gates entry. */
export function EntranceCover({ publication, showImage, children }: {
  publication: PublicPublication; showImage: boolean; children: ReactNode;
}) {
  const settings = entranceFor(publication.exhibition), generation = useRef(0);
  const [image, setImage] = useState<{url:string;width:number;height:number;generation:number}|null>(null);
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const work=publication.exhibition.artworks.find(a=>a.assets.some(asset=>asset.id.toLowerCase()===settings.imageAssetId?.toLowerCase()));
  const ratio=work&&work.dimensions.height>0?work.dimensions.width/work.dimensions.height:4/3;
  useEffect(() => {
    const current=++generation.current, abort = new AbortController();
    let objectURL = '';
    setImage(null); setLoaded(false); setFailed(false);
    if (!showImage || !settings.imageAssetId) return;
    const id = settings.imageAssetId.toLowerCase();
    const inventory = publication.exhibition.artworks.flatMap(a => a.assets).find(a => a.id.toLowerCase() === id);
    const asset = publication.assets.find(a => a.assetId.toLowerCase() === id);
    if (!inventory || !asset) { setFailed(true); return; }
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]);
    void fetchVerifiedAsset({ publicationId: publication.publication.id, revisionSha256: publication.publication.revisionSha256,
      inventory, asset, signal, ...publication.local, maxBytes: MAX_COVER_BYTES }).then(bytes => {
      signal.throwIfAborted();
      const view = new DataView(bytes), signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (bytes.byteLength < 33 || signature.some((n, i) => view.getUint8(i) !== n) || view.getUint32(8) !== 13 ||
          view.getUint32(12) !== 0x49484452 || view.getUint32(16) < 1 || view.getUint32(20) < 1 ||
          view.getUint32(16) > 4096 || view.getUint32(20) > 4096) throw Error('COVER_PNG_LIMIT');
      if(current!==generation.current)return;
      objectURL = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      setImage({url:objectURL,width:view.getUint32(16),height:view.getUint32(20),generation:current});
    }).catch(() => { if (!abort.signal.aborted&&current===generation.current) setFailed(true); });
    return () => { abort.abort(); if(current===generation.current)generation.current++;if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [publication, showImage, settings.imageAssetId, retry]);
  return <section className="entrance-cover" aria-label="전시 표지" data-image-position={settings.mobilePosition} data-has-image={Boolean(showImage&&settings.imageAssetId)}>
    {showImage && settings.imageAssetId && <div className="entrance-cover-image" style={{aspectRatio:String(ratio)}} aria-busy={!loaded&&!failed} data-image-state={failed?'failed':loaded?'ready':'loading'}>
      <span className="entrance-cover-image-paper" aria-hidden="true"><span/><span/><span/></span>
      {image&&!failed&&<img key={image.url} src={image.url} width={image.width} height={image.height} alt={settings.imageAlt} decoding="async" onLoad={()=>{if(image.generation===generation.current)setLoaded(true);}} onError={() => {if(image.generation===generation.current)setFailed(true);}} />}
      {failed && <div className="entrance-cover-image-failure"><p role="status">표지를 불러오지 못했어요. 입장과 글 관람은 이용할 수 있어요.</p><button onClick={() => setRetry(n => n + 1)}>표지 다시 불러오기</button></div>}
    </div>}
    <div className="entrance-cover-copy">
      <h1>{publication.exhibition.title}</h1>
      {settings.artist && <p className="entrance-cover-artist">{settings.artist}</p>}
      {settings.introduction && <p className="entrance-cover-introduction">{settings.introduction}</p>}
      {children}
    </div>
  </section>;
}
