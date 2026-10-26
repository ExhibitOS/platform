// SPDX-License-Identifier: AGPL-3.0-or-later
import {renderToStaticMarkup} from 'react-dom/server';
import {entranceFor} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import {EntranceReadingShell} from './EntranceReadingShell';
/** Build-time bootstrap uses the actual presentation components and interpretation. */
export function renderEntranceShell(exhibition:Exhibition){
 const settings=entranceFor(exhibition),work=exhibition.artworks.find(a=>a.assets.some(v=>v.id.toLowerCase()===settings.imageAssetId?.toLowerCase())),ratio=work&&work.dimensions.height>0?work.dimensions.width/work.dimensions.height:4/3;
 return renderToStaticMarkup(<EntranceReadingShell exhibition={exhibition} title={exhibition.title} artist={settings.artist} introduction={settings.introduction} hasImage={!!settings.imageAssetId} folded={settings.presentation?.coverUnfold!==false} ratio={ratio} status={<p className="publication-entry-status-quiet" role="status">전시 정보를 확인하고 있어요.</p>}/>);
}
