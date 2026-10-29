// SPDX-License-Identifier: AGPL-3.0-or-later
import {FOOTSTEP_RESOURCE_NAMESPACE,footstepResourcesFor,type FootstepFamily} from '@exhibitos/spec/footstep-resources';
import type {Exhibition} from '@exhibitos/spec';
/** Called only as part of an explicit authored sound selection. */
export function declareFootstepFamily(doc:Exhibition,family:FootstepFamily){
 footstepResourcesFor(doc); // Reject malformed existing declarations; never overwrite them.
 const existing=doc.extensions?.[FOOTSTEP_RESOURCE_NAMESPACE] as {version:1;families:FootstepFamily[]}|undefined;
 const families=[...new Set([...(existing?.families??[]),family])].sort();
 doc.extensions={...doc.extensions,[FOOTSTEP_RESOURCE_NAMESPACE]:{version:1,families}};
}
