// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, createRef } from "react";
import type { ReactNode } from "react";

/** Keep the publication's text and artwork list mounted if optional 3D fails. */
export class ViewerBoundary extends Component<{
  children: ReactNode;
  focusFallback: boolean;
  onUnavailable(): void;
  onReturn(): void;
}, { failed: boolean }> {
  state = { failed: false };
  private fallbackButton = createRef<HTMLButtonElement>();

  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    this.props.onUnavailable();
    // An asynchronous import failure must not move focus out of an open dialog.
    if (this.props.focusFallback) this.fallbackButton.current?.focus();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section aria-label="3D 관람 오류">
      <p role="alert">3D 관람을 열지 못했어요. 작품 목록과 설명은 계속 볼 수 있어요.</p>
      <button ref={this.fallbackButton} onClick={this.props.onReturn}>작품 목록으로 돌아가기</button>
    </section>;
  }
}
