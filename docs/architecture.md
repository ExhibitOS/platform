# 저장소 역할과 빌드 경계

<a id="repository-roles-build-boundaries"></a>
이 문서는 저장소별 책임과 빌드 경계의 기준입니다. 사용자에게 보이는 앱과 코드 저장소는 같은 구분이 아닙니다. Studio·CMS의 네이티브 조작 UI는 Manager에, 작품·전시 도메인과 API·저장·공용 3D·OEX 기반은 Platform에 둡니다. 이 구분은 코드 이동·새 저장소·이름 변경 지시나 기능 전체의 수락 선언이 아닙니다. 실제 제공 수준은 [1차 출시 방향과 현재 범위](../README.md#first-release-direction)를 따릅니다.

초기 `open-exhibition-project-plan.md`와 `exhibitos-private-capture-github-architecture.md`의 저장소 제안·2026-10-01 생성/clone 기록은 과거 설계입니다. 그때의 초기화·GitHub 계정/조직 상태를 현재 상태로 해석하지 않습니다.

## MVP 저장소

프로젝트 총괄과 유지보수는 별도 비공개 [operations](https://github.com/ExhibitOS/operations) 저장소에서 관리합니다. 에이전트 작업 지침, 명령 사용법, 운영 결정, Git 백업·복원 도구를 포함합니다. 제품의 빌드 의존성으로 연결하지 않습니다. 기존 로컬 구성에서 `operations/`는 독립 Git 저장소이며 platform의 `.gitignore`로 제외합니다.

| 기존 저장소 | 공개 경계 | 책임 |
| --- | --- | --- |
| [platform](https://github.com/ExhibitOS/platform) | Public | 작품·전시 데이터와 도메인, API·저장, 공용 3D·Viewer, OEX·정적 출력 기반. 기존 웹 Studio/CMS 구현도 여기서 보존 |
| [manager](https://github.com/ExhibitOS/manager) | Public | SwiftUI/AppKit 앱과 통합 Studio/CMS 조작, Docker 없는 서비스 실행, 백업·업데이트·배포 관리. Platform API·공용 렌더러를 소비하며 도메인을 중복 구현하지 않음 |
| [spec](https://github.com/ExhibitOS/spec) | Public | 공개 OES/OEX/OED 형식·호환 계약과 validators·conformance |
| [capture-ios](https://github.com/ExhibitOS/capture-ios) | Private | ExhibitOS Capture의 촬영·원본 보존·EXCP 생성/전달 |
| [capture-processing](https://github.com/ExhibitOS/capture-processing) | Private | ExhibitOS Processing의 촬영본 처리·재구성·모델 마무리와 일반 GLB 출력 |
| [website](https://github.com/ExhibitOS/website) | Private 저장소 / Public 사이트 | 소개·도움말·Viewer 데모 진입. Studio 편집 데모 진입은 제공하지 않음. 사이트 공개와 저장소 공개를 구분 |
| [operations](https://github.com/ExhibitOS/operations) | Private | 승인·운영 지침·상태·인수인계·증거 참조. 제품 빌드/설치 의존성이 아님 |
| [deployment](https://github.com/ExhibitOS/deployment) | Public | 기존 배포·진단 어댑터. 네이티브 제작 UI나 배포 전체 수락을 대신하지 않음 |
| [docs](https://github.com/ExhibitOS/docs) | Public | 사용자·개발자 안내. 역할/빌드 경계는 이 문서를 참조 |

이 저장소는 `platform`입니다. 이곳의 `docs/`는 플랫폼 관련 안내이며 별도 `docs` 저장소의 사용자 안내와 구분합니다. 다른 저장소를 README로 초기화하고 아직 clone하지 않았다는 설명은 2026-10-01 당시 상태입니다.

초기 제안의 `templates`, `examples`, `capture-pipeline`, `capture-ml`, `capture-datasets`, `capture-internal-tools` 분리는 현재 작업이 아닙니다. 구조 개선은 안정화 후 실제 필요가 확인될 때 별도로 판단합니다.

기획 문서의 초기 monorepo 예시와 분리안만으로 현재 소스를 이동하지 않습니다. 기존 저장소·브랜치·bundle/Keychain 식별자·데이터 경로·외부 URL을 유지합니다.

## 의존 관계

```text
Public Spec artifact → Public Platform domain / API / storage / shared3D / OEX
Native Manager / Studio-CMS controls → Public Platform API / shared3D
Optional ExhibitOS Capture → Optional ExhibitOS Processing → GLB → Studio
Other capture / modeling tools → supported GLB → Studio
Studio → exhibition → OEX export
```

Processing의 최신 마무리 도구 확장과 구현 한계는 [현재 제품 방향](../README.md#first-release-direction)을 따릅니다. 아래 날짜의 역할 설명은 당시 결정이며, 작품·전시·OEX의 Studio 소유권은 계속 유지합니다.

2026-10-21 역할 결정: ExhibitOS Processing은 ExhibitOS Capture 촬영본 처리·모델 확인·GLB 저장만 담당하고, Studio는 GLB로 작품을 생성해 정보·치수·권한·출처·전시와 OEX 내보내기를 관리합니다. ExhibitOS Capture와 ExhibitOS Processing은 선택적 제작 도구입니다. 지원되는 GLB가 있으면 두 앱의 설치·계정·서명·촬영 이력이나 OES/별도 메타데이터 파일 없이 Studio에서 작품을 만들 수 있습니다. 제목·작가·실측 치수·권한·출처는 Studio에서 입력하며, 사용자 제공 출처를 인증된 촬영 기록으로 간주하지 않습니다.

공개 규격은 작품의 내부 저장·검증 계약으로 재사용합니다. 비공개 알고리즘·SDK·저장소·빌드 서버·앱 서명·App Store 영수증을 공개 컴포넌트의 빌드/실행/작품 등록에 요구하지 않습니다. 자체 서버/DB/인증으로 실행할 수 있어야 하며, 선택 앱의 배포·지원 중단과 공개 제품 사용을 분리합니다. 기존 OEX 가져오기·파일·출처 증거는 유지합니다. 새 역할의 구현·GUI 검증과 이 구조 결정을 구분합니다.

원본 사진, depth, camera poses, ML models, proprietary datasets는 공개 Git에 저장하지 않습니다. `.gitignore`는 실수로 추가하는 것을 줄이기 위한 규칙이며 접근 제어나 비공개 저장소를 대체하지 않습니다.

## 사용자 설치와 개발자 빌드

설치 사용자의 진입점은 검증된 Manager 앱/배포물입니다. Docker·개발 도구·터미널 설치 없는 실행이 목표이며 아래 소스 빌드 요구를 일반 사용자 준비물로 안내하지 않습니다. 현재 SwiftUI 개발 후보의 부분 검증은 공식 서명 설치 프로그램·다운로드·깨끗한 사용자 설치 수락과 구분합니다. 공개 Viewer 관람에는 Capture/Processing 설치가 필요 없습니다.

| 대상 | 기존 개발 진입점 | 필수 의존성과 한계 |
| --- | --- | --- |
| Platform | 루트 `npm ci`, `npm run build` → studio-contract → storage → API → web | Node 24.21.0/npm 11.19.0, public npm 패키지와 공개 Spec vendored artifact. API emit은 `apps/api/tsconfig.build.json`; `tsconfig.json` 타입 검사는 emit하지 않음 |
| Manager native | native 개발 소스의 `native/Package.swift`, `crates/lifecycle`의 `exhibitos-native`, `native/README.md` | SwiftUI/AppKit 등 Apple frameworks·Xcode SDK·고정 Rust 도구체인. 해당 소스의 원격 통합 여부를 구분. `scripts/package-native-preview.py`는 이미 빌드한 Swift/helper와 선택적 Platform payload를 새 로컬 검증 앱으로 조립할 뿐 build/sign/install/launch하지 않음 |
| Manager 기존 Tauri | 루트 `npm run build`, `npm run desktop:build` | 기존 React/Vite·Tauri 개발 경로이며 native SwiftUI 빌드와 별개. 기존 Docker/Podman·Compose 안내는 해당 컨테이너 경로에만 적용 |
| Platform runtime/정적 Viewer | 기존 `scripts/package-local-runtime.mjs`; native 개발 후보의 `scripts/package-native-runtime.mjs`; `apps/web/vite.static.config.ts`의 Viewer target | native producer는 검증한 별도 소스 후보의 진입점이며 현재 모든 checkout/main에 있다고 가정하지 않음. 컨테이너 adapter와 Node/PostgreSQL·공용 출력 포함 native payload를 구분하고 로컬 검증 payload를 출시 배포물로 간주하지 않음. [runtime 안내](runtime-packaging.md)·[정적 전시 안내](pages-render.md) 참조 |
| Spec | `npm run build`, `npm run artifact:build` | 현재 Spec 소스와 소비자가 고정한 배포판 버전은 다를 수 있음. Platform/Processing은 public vendored draft.3, Capture의 계약 도구는 draft.1을 사용하며 현재 Spec HEAD로 자동 교체하지 않음 |
| Capture | `CaptureSpike.xcodeproj` / `CaptureSpike` scheme; [개발 안내](https://github.com/ExhibitOS/capture-ios/blob/main/README.md) | Xcode/iOS SDK와 기록된 native KTX 파생 라이브러리. Node 계약 도구는 public Spec artifact를 사용. 비공개 개발 `.app`은 공개 설치/스토어 배포 수락이 아님 |
| Processing | `native/mac-processing/Package.swift`에서 `xcrun swift build --jobs 1`의 CLI/core product `exhibitos-mac-processing`; [개발 안내](https://github.com/ExhibitOS/capture-processing/blob/main/native/mac-processing/README.md) | macOS/Apple frameworks와 같은 저장소의 `../mac-output`. 이 명령만으로 전체 SwiftUI 앱 빌드/GUI 수락을 입증하지 않음. 패키징의 Node/public Spec 의존성과 재구성을 구분하며 `scripts/package-mac-app.py`는 기존 실행 파일·Node를 지정하는 개발 조립 경로 |
| 홈페이지 | `npm run build` → `scripts/build.mjs`; `npm run check` | 홈페이지 assets의 Workers 설정과 Platform 전시의 Cloudflare Pages 배포는 별개. `wrangler deploy`는 기존 허용 대상·비용/권리 조건에서만 실행 |
| deployment / docs / operations | 배포 어댑터의 기존 `diagnose`·`ssh`; 안내 저장소; 비공개 운영 도구 | 이 역할 구분으로 새 앱/빌드를 만들지 않음. 비공개 operations·로컬 승인 자료는 어떤 공개 컴포넌트의 설치/빌드 전제도 아님 |

다음 관련 기능 통합 때 실제 잘못된 의존성·중복 구현·오래된 출력 참조·개인 경로 의존만 수정합니다. 출시 후보 고정 전 기존 최종 검사와 유효한 깨끗한 checkout 근거로 소스·빌드·패키지·설치/업데이트·문서의 일치를 확인하며 기록을 늘리기 위해 전체 검사를 반복하지 않습니다.

## Git 운영

기본 브랜치는 `main`, 작업 브랜치는 `codex/<작업명>`을 사용합니다. 원격은 `https://github.com/ExhibitOS/platform.git`입니다. 초기 문서의 조직·보호 규칙·CODEOWNERS·CI·라이선스를 나중에 구성한다는 설명은 당시 계획입니다. 현재 라이선스·워크플로·저장소 설정과 실제 PR의 적용 규칙을 확인하며, 이 문서로 전역 설정이나 자동 배포를 변경하지 않습니다.
