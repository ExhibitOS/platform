// SPDX-License-Identifier: AGPL-3.0-or-later
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ViewerInputGuide, resolveViewerInputMode } from "./ViewerInputGuide";
import { WalkingControls } from "./WalkingControls";

it("uses safe drag or touch defaults without claiming a mouse/trackpad hardware detector", () => {
  expect(resolveViewerInputMode("auto", false)).toBe("trackpad");
  expect(resolveViewerInputMode("auto", true)).toBe("touch");
  for (const mode of ["pointer", "trackpad", "touch"] as const) {
    expect(resolveViewerInputMode(mode, false)).toBe(mode);
    expect(resolveViewerInputMode(mode, true)).toBe(mode);
  }
});

it.each(['pointer','trackpad','touch'] as const)('offers explicit shared help for %s without an automatic popup',mode=>{
 const html=renderToStaticMarkup(<ViewerInputGuide mode={mode} replayed={false} onDismiss={()=>{}}/>);
 expect(html).toContain('aria-label="조작 도움말"');expect(html).toContain('aria-expanded="false"');expect(html).toContain('name="exhibitos-visitor-panel"');
 expect(html).toContain('키보드·마우스');expect(html).toContain('터치');expect(html).not.toContain('안내 건너뛰기');expect(html).not.toContain('<aside');
 if(mode==='touch')expect(html).toContain('아래 조이스틱');else{expect(html).toContain('data-key="w"');expect(html).toContain('<kbd>← →</kbd>');}
 expect(html).not.toContain('<dialog');
});
it('does not claim walking keys in the actual ordered viewing mode',()=>{
 const html=renderToStaticMarkup(<ViewerInputGuide mode="pointer" viewingStyle="ordered" replayed={false} onDismiss={()=>{}}/>);
 expect(html).toContain('화살표로 이전·다음 작품');expect(html).not.toContain('data-key="w"');expect(html).toContain('자유롭게 관람');
});

it("keeps explicit capture optional while retaining walking and safe-stop controls", () => {
  const props = { available:true, walking:true, paused:true, settings:{ speed:1.3 as const, eyeHeight:1.6, reducedMotion:true }, onSettings:()=>{}, actions:null, message:"일시 정지" };
  const drag = renderToStaticMarkup(<WalkingControls {...props} allowPointerCapture={false} />);
  expect(drag).not.toContain("마우스 시점 잡기</button>");
  expect(drag).toContain("이동·시점 조작 재개");
  expect(drag).toContain("정지 관람으로 전환");
  expect(drag).toContain("움직임 효과 줄이기");
  const mouse = renderToStaticMarkup(<WalkingControls {...props} allowPointerCapture />);
  expect(mouse).toContain("마우스 시점 잡기</button>");
});

it('shares three compact first-entry rows with the full help and one explicit dismiss action',()=>{
 const html=renderToStaticMarkup(<ViewerInputGuide mode="touch" replayed={false} showIntro onDismiss={()=>{}}/>);
 expect(html).toContain('aria-label="가볍게 둘러보기"');expect(html).toContain('안내 닫고 관람하기');expect(html).not.toContain('안내 건너뛰기');
 expect(html).toContain('viewer-input-brief');expect(html.match(/class="viewer-help-rows"/g)).toHaveLength(2);
 expect(html).toContain('이동 시작 후 조이스틱');expect(html).toContain('aria-expanded="false"');
});

it('shows desktop free hints without an interactive first window and suppresses a seen hint',()=>{
 const html=renderToStaticMarkup(<ViewerInputGuide mode="pointer" replayed={false} showIntro onDismiss={()=>{}}/>);
 expect(html).toContain('viewer-first-hints');expect(html).toContain('드래그해 둘러보기');expect(html).not.toContain('viewer-input-brief');
 const seen=renderToStaticMarkup(<ViewerInputGuide mode="pointer" replayed={false} showIntro hintAlreadyShown onDismiss={()=>{}}/>);
 expect(seen).not.toContain('viewer-first-hints');
 const ordered=renderToStaticMarkup(<ViewerInputGuide mode="pointer" viewingStyle="ordered" replayed={false} showIntro onDismiss={()=>{}}/>);
 expect(ordered).not.toContain('viewer-first-hints');expect(ordered).toContain('viewer-input-brief');expect(ordered).not.toContain('data-key="w"');
});
