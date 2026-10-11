// SPDX-License-Identifier: AGPL-3.0-or-later
export type ViewerMetric='visit'|'session'|'exhibition-dwell'|'artwork-dwell'|'room-visit'|'completed';
export interface ViewerAnalyticsEvent {consent:true;metric:ViewerMetric;resourceId?:string;durationSeconds?:number}
export interface ViewerAnalyticsOptions {publicationId:string;local:boolean;post:(payload:ViewerAnalyticsEvent)=>unknown;clock?:()=>number}
/** One in-memory viewing session, not a unique-person counter or a movement history. */
export class ViewerAnalytics {
 private readonly options:ViewerAnalyticsOptions;
 private readonly clock:()=>number;
 private enabled=false;
 private showing=true;
 private started=false;
 private completed=false;
 private roomId:string|null=null;
 private artworkId:string|null=null;
 private last:number|null=null;
 private exhibitionMs=0;
 private artworkMs=0;
 constructor(options:ViewerAnalyticsOptions){this.options=options;this.clock=options.clock??(()=>performance.now());}
 private now(){const value=this.clock();return Number.isFinite(value)?value:null;}
 private advance(){const now=this.now();if(this.enabled&&this.showing&&this.last!==null&&now!==null){const elapsed=Math.max(0,Math.min(3600000,now-this.last));this.exhibitionMs=Math.min(3600000,this.exhibitionMs+elapsed);if(this.artworkId)this.artworkMs=Math.min(3600000,this.artworkMs+elapsed);}this.last=this.enabled&&this.showing?now:null;}
 private emit(event:ViewerAnalyticsEvent){if(!this.enabled||this.options.local||!this.options.publicationId)return;try{const result=this.options.post(event);if(result&&typeof (result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});}catch{/* Analytics failure never prevents viewing or retries without consent. */}}
 private dwell(metric:'exhibition-dwell'|'artwork-dwell',milliseconds:number,resourceId?:string){const seconds=Math.min(3600,Math.floor(milliseconds/1000));if(seconds>0)this.emit({consent:true,metric,...(resourceId?{resourceId}:{}),durationSeconds:seconds});return milliseconds-seconds*1000;}
 setConsent(consent:boolean){if(!consent){this.enabled=false;this.last=null;this.exhibitionMs=0;this.artworkMs=0;return;}if(this.enabled||this.options.local||!this.options.publicationId)return;this.enabled=true;this.last=this.showing?this.now():null;if(!this.started){this.started=true;this.emit({consent:true,metric:'visit'});this.emit({consent:true,metric:'session'});}if(this.roomId)this.emit({consent:true,metric:'room-visit',resourceId:this.roomId});}
 room(roomId:string){if(roomId===this.roomId)return;this.roomId=roomId;this.emit({consent:true,metric:'room-visit',resourceId:roomId});}
 artwork(artworkId:string|null){if(artworkId===this.artworkId)return;this.advance();if(this.artworkId)this.dwell('artwork-dwell',this.artworkMs,this.artworkId);this.artworkMs=0;this.artworkId=artworkId;}
 visible(visible:boolean){if(visible===this.showing)return;this.advance();this.showing=visible;this.last=this.enabled&&visible?this.now():null;}
 flush(){if(!this.enabled)return;this.advance();this.exhibitionMs=this.dwell('exhibition-dwell',this.exhibitionMs);if(this.artworkId)this.artworkMs=this.dwell('artwork-dwell',this.artworkMs,this.artworkId);}
 complete(){if(!this.enabled||this.completed)return;this.completed=true;this.emit({consent:true,metric:'completed'});}
}
