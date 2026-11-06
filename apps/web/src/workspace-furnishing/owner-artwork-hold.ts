// SPDX-License-Identifier: AGPL-3.0-or-later
import type {AssetPeakBudget} from '../viewer/loading';
/** Release only after a failure before decode or an observed clean image cleanup. */
export class OwnerArtworkHold {
 private started=false;private cleanImageFailure=false;private active=true;
 constructor(private readonly ledger:AssetPeakBudget,private readonly key:string,initial:number){ledger.reserve(key,initial);}
 reserveDecode(bytes:number){this.ledger.reserve(this.key,bytes);this.started=true;}
 markCleanImageFailure(){this.cleanImageFailure=true;}
 failure(){if(!this.started||this.cleanImageFailure)this.release();}
 release(){if(this.active){this.active=false;this.ledger.release(this.key);}}
}
