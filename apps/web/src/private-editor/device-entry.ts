// SPDX-License-Identifier: AGPL-3.0-or-later
// Device signals are captured on entry, never on viewport or orientation changes.
export type DeviceSignals = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  userAgentData?: { mobile?: boolean; platform?: string };
};

export function allowsPrivateEditorEntry(device: DeviceSignals): boolean {
  const ua = device.userAgent;
  const platform = device.platform;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || /iPhone|iPad|iPod|Android/i.test(platform)) return false;
  if (/Android|iOS/i.test(device.userAgentData?.platform ?? '') || device.userAgentData?.mobile === true) return false;
  // iPadOS Safari can present a desktop Macintosh UA and platform.
  if (/Mac/i.test(platform) && device.maxTouchPoints > 1) return false;
  return true;
}
