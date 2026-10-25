// SPDX-License-Identifier: AGPL-3.0-or-later
// Download counts do not include decoding, physics, or the first rendered scene.
// Keep this indeterminate until the existing first-usable-scene boundary removes it.
export function EntryProgress({active,phase}:{active:boolean;phase:"space"|"artwork"|"navigation"}) {
  const label=phase==="space"?"공간을 열고 있어요.":phase==="artwork"?"첫 작품을 준비하고 있어요.":"안전한 관람을 준비하고 있어요.";
  return <div className="publication-entry-meter-space">
    {active&&<><div className="publication-entry-meter" role="progressbar" aria-label="전시장 입장 준비" aria-valuetext={label}><span aria-hidden="true" /></div>
      <p className="publication-entry-phase" role="status">{label}</p></>}
  </div>;
}
