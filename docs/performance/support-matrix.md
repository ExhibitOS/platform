# 지원 환경 matrix — T00-03

2026-10-01 기준 실제 실행한 검사와 목표 지원 후보를 구분한다.
아래 tested는 foundation의 연결 화면/API만을 뜻한다. 완성된 Studio/Viewer나
전시 rendering, 설치판, 장시간 안정성을 보장하지 않는다.

| 환경 | 현재 상태 | 실제 범위 / 남은 검사 |
| --- | --- | --- |
| macOS25.2.0 arm64, Node24.21.0/npm11.19.0 | tested | install/typecheck/lint/unit/build, compiled API health/종료 |
| macOS headless Chromium153.0.8010.12 | tested | desktop1440×900 연결·오류·재시도 및 production cold load5회 |
| 같은 desktop Chromium,375×812 viewport | emulation-tested | 좁은 레이아웃·키보드·production cold load5회; 실물 모바일 아님 |
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
화면만 측정한다. 공개 synthetic gallery fixture는 spec에서 별도로 관리되며
아직 이 화면에 로드하지 않는다. 방·조각·회화·조명·walk collision을 구현한 뒤
공식 scene fixture를 연결해 transfer/60초 frame trace/메모리를 재측정한다.
현재 수치로 gallery60FPS, mobile30FPS나 모바일400MB를 주장하지 않는다.
