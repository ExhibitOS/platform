# ExhibitOS / Open Exhibition

작품과 전시 공간을 제작하고, 관람하고, 배포하고, 보존하기 위한 디지털 전시 인프라입니다.

현재 웹 시작 화면과 HTTP API의 개발 기반을 실행할 수 있습니다. Artist CMS에서 작가·작품 metadata와 제한된 GLB/PNG 업로드·검토·미리보기를 실행할 수 있습니다. Studio는 계정 없는 오프라인 draft, 공간·작품 배치·조명 편집과 검증된 서버 revision의 명시적 공개·철회를 지원합니다. 공개 Viewer는 입구 우선 GLB/PNG·경량/상세 품질·취소/재시도를 지원합니다. 보행은 물리·키보드·터치 회귀 검사와 macOS Chrome의 실제 마우스 회전·Esc 정지 검증을 통과했습니다. 오디오는 명시적 소리 켜기, 재질별 발소리·공간 소리·작가 음성·PCM WAV 녹음/승인과 작품 상세 보기를 지원하며 실제 로컬 통합 검사를 통과했습니다. 실물 오디오 기기 검증과 배포판은 후속 작업입니다. 저장 metadata 및 제한된 인증 API를 개발 환경에서 검사할 수 있습니다.

## 저장소 경계

공개 플랫폼은 Studio, Viewer, Runtime, CMS, API, Realtime을 포함합니다. 비공개 Capture 구현을 가져오거나 private submodule에 의존하지 않습니다.

Capture iOS 앱과 processing pipeline은 별도 비공개 저장소에서 개발하며, 공개 OES artwork contract를 통해 결과물을 전달합니다. OES/OEX/OED는 현재 프로젝트에서 제안하는 규격입니다.

저장소 분리 계획은 [architecture.md](docs/architecture.md), Git 설정 및 인증 이후 절차는 [git-setup.md](docs/git-setup.md)를 참고하세요.

## 개발 시작점

첫 개발 목표는 OES artwork contract 정의, GLB import, 기본 Viewer와 전시 공간 연결입니다. 실제 작품 원본과 Capture dataset은 별도 비공개 object storage에서 관리합니다. 공개 예제에는 재배포 가능한 데이터만 사용합니다.

## 로컬 실행과 검사

Node **24.21.0**, npm **11.19.0**을 사용합니다. nvm이 있다면 저장소에서
`nvm use`를 실행하세요 (`nvm install`은 해당 버전이 없을 때만).
nvm 없이 실행한다면 설치한 runtime의 bin 경로를 작업 변수로 지정하세요. system Node는 변경하지 않습니다.

```sh
NODE_RUNTIME_BIN="<Node 24.21.0 설치 경로>/bin"
export PATH="$NODE_RUNTIME_BIN:$PATH"
node --version
npm --version
npm ci
npm run build
```

다른 기기에서는 `.nvmrc`의 버전을 설치하고 같은 명령을 실행합니다. 위 경로는
설치 위치에 맞춰 지정하는 예시이며 CI와 product code에 사용자 경로 의존성이 없습니다.
첫 실행에서는 위 `npm run build`로 storage와 studio-contract의 공통 workspace 출력을 준비합니다. 공통 패키지를 수정한 뒤에도 다시 build하세요. 두 터미널에서 각각 실행하세요.

```sh
npm run dev:api
npm run dev:web
```

웹은 `http://127.0.0.1:5173`, API health는
`http://127.0.0.1:3000/api/v1/health`입니다. 웹의 연결 확인 버튼이 API 상태를
확인하고 실패 시 재시도를 제공합니다. API는 기본 loopback bind이며
`HOST`/`PORT`로 지정할 수 있습니다. health는 process liveness입니다.
인증은 아래 별도 설정으로 활성화합니다. Network 운영의 TLS terminator·DB/storage readiness와 production qualification은 별도 구성·검증이 필요합니다.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npx playwright install chromium
npm run test:e2e
```

`check`는 typecheck/lint/unit tests/build를 순서대로 실행합니다. E2E는 자체적으로
두 개발 서버를 띄우며 이미 사용 중인 3000/5173 포트를 재사용하지 않습니다.
API 정상 응답과 404, 웹 연결·실패 후 재시도, 좁은 화면과 키보드 동작을
검사합니다. 브라우저 설치 후 `scripts/verify.sh`는 CI와 같은 검사 명령을
실행합니다. `npm run build` 결과는 `apps/web/dist`와 `apps/api/dist`에 생성되고
빌드한 API는 `npm run start --workspace @exhibitos/api`로 실행합니다.
웹 빌드 배포 시 `/api` reverse proxy는 별도 구성해야 합니다.

CI는 수동 `workflow_dispatch`를 유지합니다. 공개 저장소의 표준 무료 Ubuntu runner는
비용 조건 검토 후 실행하며, 유료 runner나 확인되지 않은 할당량은 사용하지 않습니다.
로컬 검증 결과와 hosted 실행 결과는 구분합니다. 저장소 checkout과 공개 npm registry만 필요하며
operations, Capture, 실제 작품, 비밀정보가 없는 fresh checkout에서도 검사할 수
있습니다. 후속 저장소도 exact toolchain + lockfile + 명시적 검사 명령 +
secret-free fixture 원칙을 따르고 자신에게 필요한 언어 도구는 별도로 선택합니다.
선택 이유와 버전 근거는 [ADR](docs/adr/0001-platform-toolchain.md)에 있습니다.

## 공개 계약 conformance

공개 `@exhibitos/spec` draft artifact를 immutable SHA-256과 upstream source
commit으로 고정한 개발용 Node 검사를 추가했습니다. 독립 checkout에서
`npm ci`, `npm run conformance`, `npm run test:contracts`를 실행할 수 있습니다.
같은 공개 fixture의 OES/OEX/OED 정상·오류 계약을 검사하며 operations나
private spec clone을 요구하지 않습니다. 자세한 artifact provenance·라이선스·
업데이트 절차는 [contracts/README.md](contracts/README.md)를 읽으세요.

## 지원 환경과 baseline

실제로 검사한 범위와 아직 검증하지 않은 지원 후보는
[지원 matrix](docs/performance/support-matrix.md)에 구분했습니다.
`npm run build && npm run measure:baseline`은 production 웹의 고정 조건에서
desktop/좁은 viewport 각각 5회 cold load를 측정합니다.
[측정 결과와 한계](docs/performance/baseline.md)는 실제 mobile/GPU/3D 성능
보장이 아니며 synthetic gallery 성능 측정은 후속 렌더링 단계에서 수행합니다.

## 라이선스

이 저장소의 프로젝트 코드 전체(현재 분리되지 않은 웹/API 포함)는
[GNU AGPL v3 또는 이후 버전](LICENSE), SPDX `AGPL-3.0-or-later`로 제공합니다.
제3자 패키지는 각각의 원래 라이선스·copyright·고지를 유지하며 이 프로젝트의
라이선스로 변경하지 않습니다. 웹에 번들되는 React/React DOM/Scheduler/Three.js/AJV와 공개 schema 검증 코드의 원문
고지는 build에서 [THIRD_PARTY_NOTICES.txt](apps/web/public/THIRD_PARTY_NOTICES.txt)로
보존하고 배포 산출물에 포함합니다. 새로운 browser 의존성을 추가할 때 notice
목록도 갱신합니다. build/server 도구의 원래 LICENSE는 설치된 npm 패키지에
유지합니다(MPL-2.0 build 도구를 포함해 원래 권리를 AGPL로 바꾸지 않습니다).
작품·이미지·모델·metadata의 권리는 작가 또는
권리자에게 남고 별도의 asset rights manifest를 따릅니다. 코드 라이선스가
사용자 작품에 적용되거나 재배포 권한을 자동으로 부여하지 않습니다.

Storage metadata, migration, local development and recovery commands are documented in [docs/storage.md](docs/storage.md). `npm run test:storage` runs actual isolated PostgreSQL and S3-compatible integration tests with Docker. The storage package provides internal primitives; protected resource APIs, file-format approval and publication workflows remain subsequent tasks.

Operator service backups, external encryption keys, quiescence and fresh isolated
restore steps are documented in [docs/storage-service-backup.md](docs/storage-service-backup.md).
`npm run test:service-backup` exercises nonempty synthetic PostgreSQL/File/S3
data and restore rejection cases with Docker. Tenant administrators can inspect
their own `GET /api/v1/tenants/:tenantId/integrity` report; full DB backups stay
in the local operator CLI. Validation results and deployment limits are recorded
separately from implementation availability.

인증·RBAC·bootstrap·TLS proxy 설정은 [docs/auth.md](docs/auth.md), 실제 경로와 오류 계약은 [OpenAPI](contracts/auth-openapi.json)에 있습니다. `npm run test:auth`는 Chromium과 Docker가 필요하며 UUID로 격리한 합성 PostgreSQL/HTTP/브라우저 검사입니다. `npm run build` 이후 `npm run auth:bootstrap`에 bounded JSON stdin을 전달합니다. 자격정보를 명령 인수나 로그에 넣지 마세요.

인증된 단일 GLB/PNG 업로드·import job은 [import 흐름](docs/imports.md)과 [OpenAPI](contracts/import-openapi.json)를 참고하세요. `npm run test:import`는 실제 격리 PostgreSQL/파일/decoder 및 HTTP 연결 중단·worker 종료·취소 검사를 실행합니다. `approved`는 제한된 파일 검사를 통과한 비공개 asset 상태이며 공개 배포나 전체 OES/OEX import 완료를 뜻하지 않습니다.

Artist CMS는 같은 origin의 `/cms`에서 실행합니다. [CMS 사용·권리·지원 한계](docs/cms.md)와 [CMS OpenAPI](contracts/cms-openapi.json)를 읽으세요. `npm run test:cms`는 합성 PostgreSQL/API와 실제 Chromium production CMS 흐름을 검사합니다. 전시용 derivative는 복제 방지 DRM을 보장하지 않으며, 원본 다운로드와 export는 별도 서버 권한을 요구합니다.

Studio의 계정 없는 로컬 draft·오프라인 준비·JSON 백업과 선택적 서버 ETag 동기화는 `/studio`에서 사용합니다. [Studio 사용·복원·제한](docs/studio.md), [Studio OpenAPI](contracts/studio-openapi.json), [ADR 0005](docs/adr/0005-studio-drafts.md)를 읽으세요. `npm run test:drafts`는 실제 PostgreSQL/Chromium 검증이며 JSON 백업은 artwork bytes/OEX 패키지가 아닙니다.

방·벽·바닥·천장·문/창문 및 표면 PBR 편집은 [공간 편집 안내](docs/studio-geometry.md)와 [ADR 0006](docs/adr/0006-studio-geometry-materials.md)를 읽으세요. 유효한 명령만 적용하며 최근 20개 명령 undo/redo와 로컬 CAS 저장을 사용합니다. `npm run test:geometry`는 실제 생산 빌드·Chromium·IndexedDB·오프라인 서비스 워커와 3D cutout 검증입니다.

승인된 CMS 작품의 실제 치수 배치·벽 정렬·조명·시작 camera·viewpoint·선택적 route와 credits는 [Studio 작품 배치](docs/studio-placement.md)를 참고하세요. `npm run test:cms`에는 실제 승인 GLB/PNG와 서버 권한·production Chromium 배치 검사가 포함됩니다. 오프라인은 metadata와 표시되지 않은 작품의 치수 bounds를 보존하며 protected 작품 bytes를 캐시하지 않습니다.

전시의 READY 검사·명시적 immutable 공개·철회·조건부 복원과 익명 preview는 [Studio 공개 안내](docs/studio-publication.md) 및 [Publication OpenAPI](contracts/publication-openapi.json)를 따릅니다. `npm run test:publication`은 실제 격리 PostgreSQL/Chromium 검사입니다. 익명 URL은 private draft를 직접 읽지 않으며 모든 metadata/bytes 요청의 current rights를 서버가 재검사합니다.

공개 전시의 점진적 로딩·기기 예산·오류 대응은 [Viewer 안내](docs/viewer.md), 실제 수치와 미검증 범위는 [Viewer baseline](docs/performance/viewer-baseline.md)에 있습니다. `npm run test:viewer`는 synthetic20작품/40variant, 실제 PostgreSQL과 production Chromium·20cold/warm sample·두60초 render trace를 검사합니다. 물리적 모바일/GPU/RSS 지원을 보장하는 검사는 아닙니다.

보행 조작·공간 제한은 [보행 안내](docs/viewer-navigation.md), 실제 검사와 마우스 검증 범위는 [보행 결과](docs/performance/navigation-results.md)를 읽으세요. `npm run test:navigation`은 실제 PostgreSQL/production Chromium 및 마우스 캡처 검사를 요구합니다. `EXHIBITOS_NAVIGATION_HEADED=1 EXHIBITOS_NAVIGATION_CHANNEL=chrome npm run test:navigation`으로 설치된 Chrome의 전경 검사를 선택할 수 있습니다. Native 캡처를 제외하는 필터 검사는 전체 보행 완료 근거가 아닙니다.

오디오·작품 상세 보기의 작가 업로드/녹음·승인·관람 절차는
[소리와 상세 보기 안내](docs/viewer-experience.md), 계약은
[오디오 API](contracts/audio-openapi.json)를 읽으세요. `npm run test:experience`는
격리된 PostgreSQL과 production Chromium을 사용합니다. 실제 검증 범위와 물리 기기·코덱 제한은 [결과](docs/performance/experience-results.md)에 기록합니다.

공간 음향의 거리·차폐 설정, 원문을 보존하는 시간 대본·번역과 선택적 안내 동선은
[편집·관람 안내](docs/studio-curation.md)를 읽으세요. `npm run test:curation`은
합성 WAV·실제 PostgreSQL·Chromium으로 저장·공개·구역 전환·대본·글 안내를 검사합니다.
새 컨트롤의 실제 VoiceOver 및 물리 음향 검증은 별도입니다.

선언형 Spatial Scripting의 개발용 계약·관람객별 실행 코어는
[실행 코어 안내](docs/spatial-scripting-core.md)에 있습니다. `npm run test:spatial-core`는
실제 컴파일된 코어의 지연·권한·취소·재귀 제한을 검사합니다. Studio 블록 편집기와
선택적 Viewer 연결은 [공간 스크립트 안내](docs/spatial-scripting.md)를 따릅니다.
`npm run test:scripting`으로 실제 저장·공개·장면과 취소를 검사합니다. 기존 OES의 비활성 script를 켜지 않습니다.

글·목록으로 시작하고 선택적으로 3D를 여는 접근성 관람 후보는
[관람 안내](docs/viewer-accessibility.md)와 [검사 프로토콜](docs/accessibility-protocol.md)에 있습니다.
`npm run test:accessibility`는 실제 합성 공개 전시의 키보드·텍스트·대본 흐름과
대비·움직임 설정, cold-load 수치를 검사합니다. 실제 결과와 screen reader/물리 기기
gate가 확인되기 전 전체 접근성 적합성이나 MVP 완료를 뜻하지 않습니다.

OEX 전시 파일 흐름의 지원 형식·권한·복원·한계는 [OEX 안내](docs/oex.md)와 [OEX API](contracts/oex-openapi.json)에 있습니다. `npm run test:oex`는 실제 격리 PostgreSQL/파일/production 브라우저의 round-trip와 오류 처리를 검사합니다. [실제 검증 결과](docs/performance/oex-results.md)를 확인하세요. 전체 오프라인 배포판이나 관리용 DB 백업 완료를 뜻하지 않습니다.

Frozen exhibition and offline display implementation: [docs/freeze.md](docs/freeze.md). Actual bounded qualification and limits are recorded in [freeze-results.md](docs/performance/freeze-results.md).

고급 분할 곡선벽·계단·경사로, 자연광 시각 근사와 명시적 license의 건축
템플릿은 [고급 건축 안내](docs/advanced-architecture.md)를 읽으세요.
템플릿은 작품 bytes를 포함하지 않으며 private/unlicensed 재배포는 차단합니다.
실제 통합 검증과 기기별 지원 범위는 후속 결과 기록에서 구분합니다.

함께 관람 개발 기능과 권한·복귀·운영 제한은 [multiplayer.md](docs/multiplayer.md), 실제 로컬 부하 및 브라우저 결과는 [realtime-results.md](docs/performance/realtime-results.md)에 기록합니다. `npm run test:realtime`은 격리 PostgreSQL과 Chromium이 필요합니다.

행사·음성·안내 개발 후보의 사용법과 개인정보 한도는 [docs/opening.md](docs/opening.md)를 참고하세요. 최종 실제 DB/브라우저 검증은 `npm run test:opening`, 독립 native 음성 후보 검사는 `EXHIBITOS_VOICE_CHROME=1 npm run test:voice-transport`입니다. 전체 릴리스·실기기·인터넷 중계 지원 완료를 의미하지 않습니다.


### Windows x64 개발 Runtime 묶음

Node24.21.0, 실행 중인 Docker Linux engine, 이 저장소의 고정 소스에서 다음을 실행합니다.

```powershell
node scripts/package-local-runtime.mjs C:\ExhibitOS\new-runtime --platform linux/amd64
```

목적지는 없는 새 폴더여야 합니다. Manager가 만든 **새 검사 공간**을 대상으로 할 때만 앱을 닫고 `--existing-root`를 추가합니다. 기존 `bundle` 또는 `installed.json`이 있으면 덮어쓰지 않고 거부합니다. 기존 사용자 공간이나 실행 중인 서버에는 이 개발 도구를 적용하지 않습니다. 빌드 후 Engine이 보고한 OS/아키텍처가 요청과 일치해야 image archive와 manifest를 만들며, 파일 해시·고정 이미지 ID·Compose labels·loopback origin을 포함합니다.

이는 로컬 소스 빌드 도구입니다. 배포 서명·공증·자동 업데이트 권한이나 Windows 실제 설치/복원 검증을 대신하지 않습니다. `npm run test:packaging`은 파일 보존/잘못된 옵션/합성 subprocess의 아키텍처 불일치 거부 검사이며 실제 Docker 검사는 별도로 실행합니다.
