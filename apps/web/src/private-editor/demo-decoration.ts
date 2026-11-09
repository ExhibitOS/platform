// SPDX-License-Identifier: AGPL-3.0-or-later
export function isDemoDecorationSession(): boolean {
  return document.querySelector<HTMLMetaElement>('meta[name="exhibitos-demo-decoration"]')?.content === 'session-v1';
}

export const demoDecorationNotice = '현재 공개본을 이번 방문 동안 꾸며볼 수 있어요. 새로고침하거나 나가면 변경 내용이 사라져요.';
