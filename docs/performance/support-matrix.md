# 지원 환경 matrix

## 1차 출시 대상 (사용자 변경 2026-10-15)

Viewer 구현 대상은 Safari·Chrome, 공식 검증 대상은 macOS/iOS다. 아래 과거 tested는 각 기록의 한정된 결과이며 두 OS/브라우저 조합 전체의 검증 완료 선언이 아니다. Windows/Linux Chrome은 호환 후보이며 해당 OS의 Manager·Processing 구현은 1차에 요구하지 않는다. Android와 다른 브라우저 확대는 후속이다.

iPhone은 촬영·선택적 `.reduced` 확인·원본 전달, Mac Swift·RealityKit은 최종 재구성·GLB/LOD/OES와 검토를 맡는다. Mac Manager와 Mac Studio/CMS를 1차 제품으로 검증한다. 서버는 선택한 Ubuntu OCI/compose 단일 profile이며 Linux 사용자 앱 지원과 구분한다. iPhone 최종 Processing·Node 재구성·범용 cloud·AR/XR/Federation·기관 고급 연동은 후속 보류다.

## 기록된 실제 검사 범위

2026-10-15 문서 대조 기준. 아래 측정은 각 증거에 기록된 소스·날짜의 실행 결과이며, 모든 최신 변경과 지원 후보의 검증을 뜻하지 않는다.
아래 tested는 각 참조 소스의 development profile에서 실제 검사한 범위만을 뜻한다.
Foundation 연결, CMS와 Studio authoring, 익명 publication 및 제한된 GLB/PNG 점진적 Viewer를 검사했다.
보행·오디오·접근성은 아래 한정된 실제 검사 결과를 참조한다. 설치판·실물 모바일·장시간 안정성 전반의 보장을 뜻하지 않는다.

| 환경 | 현재 상태 | 실제 범위 / 남은 검사 |
| --- | --- | --- |
| macOS26.2 (build25C56, Darwin kernel25.2.0) arm64, Node24.21.0/npm11.19.0 | tested | install/typecheck/lint/unit/build, compiled API health/종료 |
| macOS headless Chromium153.0.8010.12 | tested | foundation 연결·오류·재시도/cold load5회, 실제 CMS/Studio/GLB·PNG authoring/publication preview·권한·오프라인·복원 검증 |
| 같은 desktop Chromium,375×812 viewport | emulation-tested | foundation cold load5회와 실제 CMS/Studio/publication 좁은 레이아웃·키보드 검증; 실물 모바일 아님 |
| Ubuntu GitHub Actions runner | tested / 기록된 수동 실행 | 공개 표준 runner에서 Platform foundation CI completed/success 확인([run36792560072](https://github.com/ExhibitOS/platform/actions/runs/36792560072)); 향후 실행도 비용·무료 조건 확인과 수동 dispatch 정책 유지 |
| macOS installed Google Chrome | tested / 한정 범위 | 실제 mouse/Esc 보행·focus 복귀, 사용자 VoiceOver 읽기·detail 복귀, Chrome154.0.8037.93/Apple M1 Metal 참조 성능 검사; 아래 직접 증거 참조 |
| macOS/iOS Safari 및 iOS Chrome | 1차 검증 대상 / 실제 검사 필요 | Mac Chrome 결과를 대신 사용하지 않음 |
| Windows/Linux Chrome | 호환 후보 | 실제 해당 OS 검사 전 공식 지원 아님; native 앱 구현 요구 없음 |
| Edge/Firefox/Android 및 기타 조합 | 후속 후보 | 1차 필수 검사 아님 |
| Windows desktop native apps | 후속 보류 | 기존 구현·결과 보존, 1차 출시 필수 아님 |
| macOS/iOS Safari·Chrome의 실제 기기 | 대상 조합별 미완료 | touch/GPU/memory/viewport/lifecycle은 실제 검사로 확인 |
| Apple Capture iPhone | 별도 제품의 한정 검증 | Xcode/SDK 컴파일과 지원 iPhone의 일부 실물 촬영·저장·내보내기를 확인했다. 최종 처리 품질과 전체 흐름의 검증은 별도로 남아 있으며 Platform 웹 지원에 포함하지 않음 |

## 개발 최소와 권장 기준

현재 재현 가능한 개발 toolchain은 Node24.21.0/npm11.19.0이며 Chromium 설치가
E2E와 baseline 측정에 필요하다. 이는 실제 검증한 버전이며 모든 patch에 대한
지원 선언은 아니다. GPU/메모리 최소치나 권장치를 foundation에서 추측해
정하지 않는다. 아래 P04 baseline은 기준 환경과 scene/asset hash를 기록하며,
측정하지 않은 하드웨어의 최소·권장 사양을 확정하지 않는다. 현재 모바일 개발
후보도 동일한 공개 fixture 흐름을 요구하지만 실물지원 게이트는 미통과다.

## 성능 적용 범위

[baseline.md](baseline.md)와 [baseline.json](baseline.json)은 production 진입
화면만 측정한다. 별도 [Viewer baseline](viewer-baseline.md)과 [raw samples](viewer-baseline.json)은 공개 독립build에서 synthetic방1/조각10/회화10/조명4, 실제20cold/warm entrance와 두60초 render traces를 측정한다. SwiftShader software renderer의 desktop52.63FPS는60FPS 목표미달이다. Narrow59.07FPS는 실물mobile30FPS나400MB 지원을 증명하지 않는다. Foundation수치를 gallery성능으로 확대하지 않는다.

후속 [실제 Chrome 참조 결과](accessibility-reference-results.json)는 clean fc939500의
headed Chrome154.0.8037.93/Apple M1 Metal에서 같은 20작품 장면을 측정했다.
Desktop/narrow cold 3D p95는 각각3322.60/3377.57ms, 최대 초기 전송1656019bytes,
각60초 trace는60.0069/60.0063FPS였다. 이 실행은 기존 software 결과를 삭제하거나
실물 모바일 GPU·tab working-set400MB 검증으로 대체하지 않는다.
실패한 software 측정은 [별도 결과](accessibility-software-results.json)에 보존한다.

## 현재 검증과 다음 게이트

T03-04 병합된 [publication evidence](../evidence-T03-04.md)는 exactproduct9b13d61의 실제 PostgreSQL/productionChromium/publicGLBPNG/currentrights/withdrawal/restore 결과를 기록한다. Tests30unit/8contracts와 publication16/CMS26/drafts23/geometry5/auth18/import11/foundationE2E3 및 corrected7migration22table7object/S3restore가 통과했다. 이 결과는 한정된 authoring/publication profile이며 fullViewer, unsupportedaudio/OEX, GPU성능 또는 모든 브라우저 지원을 증명하지 않는다.

T04-01 actual8b6ccc8은 root독립check36unit8contracts/E2E3/worker3/Viewer14groups와 별도 exacthead source review를 통과했다. Entrancecold/warm p95≤3.077s와initial≤1.77MB는5s/15MiB 목표안이다. 후속 한정 검증은 다음 직접 증거로 구분한다. 실물 모바일 GPU·physical working-set 검증은 남아 있다.

- [보행 결과](navigation-results.json), [실제 Chrome mouse/Esc 관찰](navigation-human-chrome.json): 고정 step 충돌·문/장애물·입력/focus 및 물리 사용자 mouse 동작 범위. 모든 브라우저·기기 보장은 아니다.
- [오디오·상세 결과](experience-results.json): 사용자 선택 후 재생·mute·autoplay 거부·transcript 대안, 상세 닫기 후 camera/focus 복귀. 모든 실제 스피커·마이크·OS 권한의 검증은 아니다.
- [접근성 결과](accessibility-results.json), [VoiceOver 관찰](voiceover-results.json): keyboard/text/list/detail·reduced motion 및 사용자가 보고한 VoiceOver 읽기와 agent가 관찰한 focus 복귀. 모든 screen reader/WCAG 인증을 뜻하지 않는다.
