# 지원 환경 matrix

2026-10-01 기준 실제 실행한 검사와 목표 지원 후보를 구분한다.
아래 tested는 현재 병합된 development profile의 실제 검사 범위만을 뜻한다.
Foundation 연결, CMS와 Studio authoring, 익명 publication 및 제한된 GLB/PNG 점진적 Viewer를 검사했다.
보행·오디오·설치판·실물 모바일·장시간 안정성은 아직 보장하지 않는다.

| 환경 | 현재 상태 | 실제 범위 / 남은 검사 |
| --- | --- | --- |
| macOS26.2 (build25C56, Darwin kernel25.2.0) arm64, Node24.21.0/npm11.19.0 | tested | install/typecheck/lint/unit/build, compiled API health/종료 |
| macOS headless Chromium153.0.8010.12 | tested | foundation 연결·오류·재시도/cold load5회, 실제 CMS/Studio/GLB·PNG authoring/publication preview·권한·오프라인·복원 검증 |
| 같은 desktop Chromium,375×812 viewport | emulation-tested | foundation cold load5회와 실제 CMS/Studio/publication 좁은 레이아웃·키보드 검증; 실물 모바일 아님 |
| Ubuntu GitHub Actions runner | candidate / hosted pending | 수동 CI 구성, 공개전 billing/무료실행조건 확인후 실제 검증 |
| desktop Chrome/Edge/Firefox/Safari | candidate | 해당 제품과 OS에서 실제 실행 필요; Chromium engine 결과만으로 확대하지 않음 |
| Windows desktop | candidate | Windows 기기/VM과 fresh checkout 실제 검증 필요 |
| iOS Safari, Android Chrome | candidate | 실물기기 touch/GPU/memory/viewport/lifecycle 검증 필요 |
| Apple Capture iPhone | external gate | 전체 Xcode·지원 iPhone·서명과 실제 촬영 검증 필요; 플랫폼과 독립 |

## 개발 최소와 권장 기준

현재 재현 가능한 개발 toolchain은 Node24.21.0/npm11.19.0이며 Chromium 설치가
E2E와 baseline 측정에 필요하다. 이는 실제 검증한 버전이며 모든 patch에 대한
지원 선언은 아니다. GPU/메모리 최소치나 권장치를 foundation에서 추측해
정하지 않는다. 3D 렌더링 P04 baseline에서 실제 기준기기와 scene/asset hash를
고정하고 최소·권장 하드웨어 및 fallback 기준을 결정한다. 현재 모바일 개발
후보도 동일한 공개 fixture 흐름을 요구하지만 실물지원 게이트는 미통과다.

## 성능 적용 범위

[baseline.md](baseline.md)와 [baseline.json](baseline.json)은 production 진입
화면만 측정한다. 별도 [Viewer baseline](viewer-baseline.md)과 [raw samples](viewer-baseline.json)은 공개 독립build에서 synthetic방1/조각10/회화10/조명4, 실제20cold/warm entrance와 두60초 render traces를 측정한다. SwiftShader software renderer의 desktop52.63FPS는60FPS 목표미달이다. Narrow59.07FPS는 실물mobile30FPS나400MB 지원을 증명하지 않는다. Foundation수치를 gallery성능으로 확대하지 않는다.

## 현재 검증과 다음 게이트

T03-04 병합된 [publication evidence](../evidence-T03-04.md)는 exactproduct9b13d61의 실제 PostgreSQL/productionChromium/publicGLBPNG/currentrights/withdrawal/restore 결과를 기록한다. Tests30unit/8contracts와 publication16/CMS26/drafts23/geometry5/auth18/import11/foundationE2E3 및 corrected7migration22table7object/S3restore가 통과했다. 이 결과는 한정된 authoring/publication profile이며 fullViewer, unsupportedaudio/OEX, GPU성능 또는 모든 브라우저 지원을 증명하지 않는다.

T04-01 actual8b6ccc8은 root독립check36unit8contracts/E2E3/worker3/Viewer14groups와 별도 exacthead source review를 통과했다. Entrancecold/warm p95≤3.077s와initial≤1.77MB는5s/15MiB 목표안이다. 실제 GPU/기기·physicalworking-set 검증과 보행/오디오 접근성 관람 gate는 후속작업이다.
