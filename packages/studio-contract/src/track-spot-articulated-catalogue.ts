// SPDX-License-Identifier: AGPL-3.0-or-later
import type {UserAssetCatalogueEntry} from './user-asset-catalogue.js';
import {ARTICULATED_TRACK_SPOT_PROFILE as profile,ARTICULATED_TRACK_SPOT_IDENTITY as source} from './track-spot-articulated-profile.js';
const root='assets/furnishings/exhibitos-authored-20261115/museum-track-spot-articulated';
export const TRACK_SPOT_ARTICULATED_CATALOGUE:UserAssetCatalogueEntry={
 id:source.catalogId,version:1,mime:source.mime,path:root+'/model.glb',bytes:source.bytes,sha256:source.sha256,triangles:5544,
 bounds:{min:[-.05999999865889549,-.19249999523162842,-.0754999965429306],max:[.05999999865889549,0,.07500000298023224]},
 rights:{licenseId:'CC0-1.0',noticePath:root+'/LICENSE-NOTICE.txt',noticeBytes:721,noticeSha256:'4c0ee253cb106600cf11e03a92abe785c0d7d5e91590a02e05377172a944b40d'},
 provenance:source.provenance,
 functional:{kind:'light',evidence:'actual-glb-geometry',consumerBehavior:'unverified',apertureCentre:profile.geometry.opticalA,apertureDesignation:'authored-reference',aim:profile.geometry.forward,pivot:profile.geometry.headPivot,pivotAxis:profile.geometry.pitchAxis,opaqueLensContact:[0,-.15,-.028999999165534973],
  articulation:{version:1,profile:profile.capability,swivel:{pivot:profile.geometry.swivelPivot,axis:profile.geometry.swivelAxis,intervals:profile.envelope.yawIntervals},pitch:{pivot:profile.geometry.headPivot,axis:profile.geometry.pitchAxis,intervals:profile.envelope.pitchIntervals},frames:{fixed:profile.parts.filter(p=>p.frame==='fixed').map(p=>p.name),yoke:profile.parts.filter(p=>p.frame==='yoke').map(p=>p.name),head:profile.parts.filter(p=>p.frame==='head').map(p=>p.name)}},
 },
};
