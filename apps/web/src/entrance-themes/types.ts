// SPDX-License-Identifier: AGPL-3.0-or-later
import type {ReactNode,Ref} from 'react';
import type {ResolvedEntranceDesign} from '@exhibitos/studio-contract';
export type {ResolvedEntranceDesign} from '@exhibitos/studio-contract';
/** Presentation only. The real host owns verified bytes, readiness and one entry action. */
export interface ThemeProps {
 content:{title:string;artist:string;introduction:string;imageAlt:string};
 image:{status:'absent'|'loading'|'decoded'|'ready'|'failed';url?:string;width?:number;height?:number;layoutRatio?:number};
 design:ResolvedEntranceDesign;
 coverState:'pending'|'revealing'|'open'|'flat';
 interactive:boolean;reducedMotion:boolean;
 layoutRef:Ref<HTMLDivElement>;
 entry:ReactNode;children:ReactNode;
 onImageLoad:()=>void;onImageError:()=>void;onRetryImage:()=>void;
}
