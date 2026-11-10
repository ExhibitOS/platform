// SPDX-License-Identifier: AGPL-3.0-or-later

export interface EntranceAsset {
  sha256: string;
  bytes: number;
}

export interface EntranceProgress {
  receivedBytes: number;
  requiredBytes: number;
}

/** One ledger per verified publication. Only required encoded exhibition data is counted. */
export function createEntranceReadiness(bootstrapBytes: number) {
  const listeners = new Set<() => void>();
  let cover: EntranceAsset | null | undefined;
  let displayedCover: string | undefined;
  let assets: readonly EntranceAsset[] | undefined;
  const received = new Map<string, number>();
  let progress: EntranceProgress | null = null;
  let coverTransfer: {identity: string; bytes: Promise<ArrayBuffer>} | undefined;

  const key = ({sha256, bytes}: EntranceAsset) => `${sha256}/${bytes}`;
  const publish = () => {
    if (cover === undefined || !assets) return;
    const required = new Map(assets.map(asset => [key(asset), asset.bytes]));
    if (cover) required.set(key(cover), cover.bytes);
    let requiredBytes = bootstrapBytes;
    let receivedBytes = bootstrapBytes;
    for (const [identity, bytes] of required) {
      requiredBytes += bytes;
      receivedBytes += received.get(identity) ?? 0;
    }
    if (progress?.receivedBytes === receivedBytes && progress.requiredBytes === requiredBytes) return;
    progress = {receivedBytes, requiredBytes};
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    snapshot: () => progress,
    setCover(asset: EntranceAsset | null) {
      cover = asset;
      displayedCover = undefined;
      if (!asset || coverTransfer?.identity !== key(asset)) coverTransfer = undefined;
      publish();
    },
    hasCoverSelection: () => cover !== undefined,
    setDisplayedCover(asset: EntranceAsset | null) {
      displayedCover = cover && asset && key(cover) === key(asset) ? key(asset) : undefined;
    },
    isDisplayedCover: (asset: EntranceAsset) => displayedCover === key(asset),
    retainCoverTransfer(asset: EntranceAsset, bytes: Promise<ArrayBuffer>) {
      coverTransfer = {identity: key(asset), bytes};
    },
    coverBytes(asset: EntranceAsset) {
      if (coverTransfer?.identity === key(asset)) return coverTransfer.bytes;
    },
    releaseCoverTransfer() {
      coverTransfer = undefined;
    },
    setRequiredAssets(required: readonly EntranceAsset[]) {
      assets = required;
      publish();
    },
    receive(asset: EntranceAsset, bytes: number) {
      const identity = key(asset);
      if (identity !== (cover && key(cover)) && !assets?.some(item => key(item) === identity)) return;
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > asset.bytes || received.get(identity) === bytes) return;
      received.set(identity, bytes);
      publish();
    },
  };
}

export type EntranceReadiness = ReturnType<typeof createEntranceReadiness>;
