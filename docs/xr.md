# 실제 크기 AR · WebXR

Viewer의 일반 3D·글 관람을 기본으로 유지합니다. 브라우저 기능 검사는 특정 기기 지원이나 실물 치수 정확도의 증명이 아닙니다. XR은 사용자가 직접 버튼을 누를 때만 시작하며, 거부·지원 부족·중단은 일반 관람으로 돌아옵니다. 움직임 줄이기 설정은 XR을 중지하고 시작을 막습니다. 자동 재시작하지 않습니다.

`ViewerXr`는 기존 renderer/camera/scene과 **선택된 승인 artwork-local 미터 object**를 연결합니다. `artwork()`는 중심 이동 이후 승인 A 변환을 포함하고 전시 방/배치 R/P는 포함하지 않아야 합니다. AR은 이 object의 geometry·texture·scale·rotation을 복제해 실측 바닥 hit-test 위치에 놓으며, metadata 치수에 맞춘 확대·축소를 하지 않습니다. 중심/바닥 pivot 이동은 배치 기준점이며 원본은 변경하지 않습니다. VR은 기존 전시 scene의 R·P·A를 유지합니다. `frame(callback)`은 root가 Three의 `setAnimationLoop` 소유권을 연결하며 null이면 일반 렌더링을 복구합니다. `suspend(true)` 동안 기존 키보드/보행 카메라를 정지합니다. 화면 이탈·Escape·명시적 중단·native session end는 종료합니다.

WebXR AR은 `immersive-ar`, `local`과 실제 `hit-test` 지원을 요청합니다. 사용자가 표면을 찾고 select/탭했을 때만 작품을 놓습니다. VR은 `immersive-vr`와 `local`을 사용합니다. Three WebXRManager가 기기 camera/reference space를 사용합니다. 카메라 영상·tracking 데이터는 저장/업로드하지 않습니다. 선택/권한 철회·publication 변경은 root가 runtime을 종료해야 합니다.

## iPhone 형식 연결

WebXR 미지원 환경에서도 현재 내보내기 허락을 확인한 승인 작품은 기존 공개 Three USDZExporter로 USDZ를 준비할 수 있습니다. `authorizeExport()`는 root의 현재 서버 export 권한 검사이며, 준비 전·후 모두 필요합니다. 공개 display 허락만으로 export를 허용하지 않습니다. 선택 object가 바뀌거나 요청이 취소되면 URL을 발급하지 않습니다. USDZ는 원래 미터 좌표·승인 affine을 유지하며 geometry를 치수에 맞춰 늘리지 않습니다. 지원 범위는 정적 MeshStandardMaterial 모델입니다. skinned/instanced 모델·material arrays·압축 texture는 대체/추정하지 않고 거부합니다. Texture는 exporter의 4096 상한 안에서 파생되므로 원본 보존 형식이나 색 품질 보증은 아닙니다.

생성된 `model/vnd.usdz+zip` 파일은 별도 탭의 Apple Quick Look `rel="ar"` 링크로 사용자가 직접 엽니다. `#allowsContentScaling=0`은 사용자 크기 변경을 막기 위한 Apple 웹 매개변수이며 실물 정확도를 보증하지 않습니다. 링크 이미지는 AR 조작 아이콘이며 작품 preview가 아닙니다. 사용자가 링크를 다시 누르는 명시적 gesture를 유지합니다. blob URL·파일 다운로드의 실제 Safari 지원 및 AR 배치/물리 치수는 **NOT_RUN**이며 특정 iPhone/iOS 지원을 확정하지 않습니다. 다운로드한 파일은 철회할 수 없으므로 export 권한 확인을 분리합니다.

공식 API 근거: [Three WebXRManager](https://threejs.org/docs/pages/WebXRManager.html), [WebXR requestSession](https://developer.mozilla.org/en-US/docs/Web/API/XRSystem/requestSession), [Three USDZExporter](https://threejs.org/docs/pages/USDZExporter.html), [Apple AR Quick Look](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look), [Apple 웹 AR의 크기 변경 제한](https://developer.apple.com/videos/play/wwdc2020/10604/). XR은 secure context·브라우저 권한/정책·사용자 gesture에 종속됩니다. UA 이름만 보고 지원을 보장하지 않습니다.

2026-10-11의 합성 XR 회귀 6개와 전체 검사(TypeScript·lint·386개 단위 검사·production build·PNG·공개 계약·패키징)가 통과했습니다. Native XR 종료 직후에는 XR frame을 정지하고 Three의 framebuffer·canvas 복구 이후 일반 관람을 다시 그리는 종료 순서를 검사했습니다. Synthetic 정적 색상 모델은 실제 설치된 USDZExporter로 ZIP bytes를 생성하고 metersPerUnit=1 및 승인 affine/원본 position 불변을 확인했습니다. 움직임 줄이기의 Quick Look 준비 차단 조건도 전체 검사 소스에 포함됐습니다. 실제 기기의 WebXR·hit-test·textured USDZ·Apple Quick Look 실행은 **NOT_RUN**입니다. 물리 지원 기기의 작품 실제 치수, 권한 거부, 움직임 설정, 일반 관람 복귀는 원래 T12-01 완료 조건으로 남습니다.
