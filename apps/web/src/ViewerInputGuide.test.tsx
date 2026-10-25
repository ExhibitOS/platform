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

it.each([
  ["pointer", "마우스 시점 잡기"],
  ["trackpad", "스크롤은 걷기 조작이 아니에요"],
  ["touch", "다른 손가락으로 오른쪽 화면"],
] as const)("explains the supported %s controls with a nonmodal skip and recovery route", (mode, expected) => {
  const html = renderToStaticMarkup(<ViewerInputGuide mode={mode} replayed={false} onDismiss={() => {}} />);
  expect(html).toContain(expected);
  expect(html).toContain('aria-label="짧은 관람 안내"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain("안내 건너뛰기");
  expect(html).toContain("걷기 재개·조작 방식·소리·텍스트 관람");
  expect(html).not.toContain("<dialog");
});

it("keeps explicit capture optional while retaining walking and safe-stop controls", () => {
  const props = { available:true, walking:true, paused:true, settings:{ speed:1.3 as const, eyeHeight:1.6, reducedMotion:true }, onSettings:()=>{}, actions:null, message:"일시 정지" };
  const drag = renderToStaticMarkup(<WalkingControls {...props} allowPointerCapture={false} />);
  expect(drag).not.toContain("마우스 시점 잡기</button>");
  expect(drag).toContain("걷기 재개");
  expect(drag).toContain("정지 관람으로 전환");
  expect(drag).toContain("움직임 효과 줄이기");
  const mouse = renderToStaticMarkup(<WalkingControls {...props} allowPointerCapture />);
  expect(mouse).toContain("마우스 시점 잡기</button>");
});
