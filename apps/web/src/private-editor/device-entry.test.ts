// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { allowsPrivateEditorEntry } from './device-entry';

describe('private editor device entry', () => {
  const desktop = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 };
  it('allows desktop regardless of viewport and ordinary touch-capable Windows', () => {
    expect(allowsPrivateEditorEntry(desktop)).toBe(true);
    expect(allowsPrivateEditorEntry({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 10 })).toBe(true);
  });
  it('restricts phones and tablets independently of keyboard or pointer', () => {
    for (const userAgent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet)', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile']) {
      expect(allowsPrivateEditorEntry({ userAgent, platform: '', maxTouchPoints: 5 })).toBe(false);
    }
    expect(allowsPrivateEditorEntry({...desktop, maxTouchPoints: 5})).toBe(false);
    expect(allowsPrivateEditorEntry({...desktop, userAgentData: { platform: 'Android', mobile: false }})).toBe(false);
    expect(allowsPrivateEditorEntry({...desktop, userAgentData: { mobile: true }})).toBe(false);
  });
});
