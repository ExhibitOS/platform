// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState, type ReactNode } from 'react';
import { entranceFor, MAX_COVER_BYTES } from '@exhibitos/studio-contract';
import type { PublicPublication } from './publication-client';
import { fetchVerifiedAsset } from './viewer/loading';
import './entrance-cover.css';

/** Fetches one verified poster PNG without initializing the 3D runtime. */
export function EntranceCover({ publication, showImage, children }: {
  publication: PublicPublication; showImage: boolean; children: ReactNode;
}) {
  const settings = entranceFor(publication.exhibition);
  const [image, setImage] = useState(''), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let objectURL = '';
    setImage(''); setFailed(false);
    if (!showImage || !settings.imageAssetId) return;
    const id = settings.imageAssetId.toLowerCase();
    const inventory = publication.exhibition.artworks.flatMap(a => a.assets).find(a => a.id.toLowerCase() === id);
    const asset = publication.assets.find(a => a.assetId.toLowerCase() === id);
    if (!inventory || !asset) { setFailed(true); return; }
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]);
    void fetchVerifiedAsset({ publicationId: publication.publication.id, revisionSha256: publication.publication.revisionSha256,
      inventory, asset, signal, ...publication.local, maxBytes: MAX_COVER_BYTES }).then(bytes => {
      signal.throwIfAborted();
      // Bound decoded pixels before passing the verified PNG to the browser.
      const view = new DataView(bytes), signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (bytes.byteLength < 33 || signature.some((n, i) => view.getUint8(i) !== n) || view.getUint32(8) !== 13 ||
          view.getUint32(12) !== 0x49484452 || view.getUint32(16) < 1 || view.getUint32(20) < 1 ||
          view.getUint32(16) > 4096 || view.getUint32(20) > 4096) throw Error('COVER_PNG_LIMIT');
      objectURL = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      setImage(objectURL);
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => { abort.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [publication, showImage, settings.imageAssetId, retry]);
  return <section className="entrance-cover" aria-label="전시 표지" data-image-position={settings.mobilePosition}>
    {showImage && settings.imageAssetId && <div className="entrance-cover-image">
      {image && <img src={image} alt={settings.imageAlt} onError={() => setFailed(true)} />}
      {!image && !failed && <p role="status">표지 이미지를 준비하고 있어요. 입장하거나 글로 먼저 관람할 수 있어요.</p>}
      {failed && <p role="status">표지 이미지를 불러오지 못했어요. 입장과 텍스트 관람은 계속 이용할 수 있어요. <button onClick={() => setRetry(n => n + 1)}>표지 다시 불러오기</button></p>}
    </div>}
    <div className="entrance-cover-copy">
      <h1>{publication.exhibition.title}</h1>
      {settings.artist && <p className="entrance-cover-artist">{settings.artist}</p>}
      {settings.introduction && <p className="entrance-cover-introduction">{settings.introduction}</p>}
      {children}
    </div>
  </section>;
}
