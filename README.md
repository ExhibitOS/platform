# ExhibitOS / Open Exhibition

작품과 전시 공간을 제작하고, 관람하고, 배포하고, 보존하기 위한 디지털 전시 인프라입니다.

현재 웹 시작 화면과 HTTP API의 개발 기반을 실행할 수 있습니다. Studio, Viewer, CMS, 인증·데이터 저장·배포판은 아직 구현되지 않았습니다.

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
```

다른 기기에서는 `.nvmrc`의 버전을 설치하고 같은 명령을 실행합니다. 위 경로는
설치 위치에 맞춰 지정하는 예시이며 CI와 product code에 사용자 경로 의존성이 없습니다.
두 터미널에서 각각 실행하세요.

```sh
npm run dev:api
npm run dev:web
```

웹은 `http://127.0.0.1:5173`, API health는
`http://127.0.0.1:3000/api/v1/health`입니다. 웹의 연결 확인 버튼이 API 상태를
확인하고 실패 시 재시도를 제공합니다. API는 기본 loopback bind이며
`HOST`/`PORT`로 지정할 수 있습니다. health는 process liveness입니다.
실제 network 운영에 필요한 인증·DB·storage readiness는 후속 작업입니다.

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

CI는 수동 `workflow_dispatch`로 준비했습니다. GitHub billing/remaining quota가
확인되지 않아 자동 trigger와 hosted 실행은 보류합니다. 로컬 검증 결과와
hosted 실행 결과는 구분합니다. 저장소 checkout과 공개 npm registry만 필요하며
operations, Capture, 실제 작품, 비밀정보가 없는 fresh checkout에서도 검사할 수
있습니다. 후속 저장소도 exact toolchain + lockfile + 명시적 검사 명령 +
secret-free fixture 원칙을 따르고 자신에게 필요한 언어 도구는 별도로 선택합니다.
선택 이유와 버전 근거는 [ADR](docs/adr/0001-platform-toolchain.md)에 있습니다.

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
라이선스로 변경하지 않습니다. 웹에 번들되는 React/React DOM/Scheduler의 원문
고지는 build에서 [THIRD_PARTY_NOTICES.txt](apps/web/public/THIRD_PARTY_NOTICES.txt)로
보존하고 배포 산출물에 포함합니다. 새로운 browser 의존성을 추가할 때 notice
목록도 갱신합니다. build/server 도구의 원래 LICENSE는 설치된 npm 패키지에
유지합니다(MPL-2.0 build 도구를 포함해 원래 권리를 AGPL로 바꾸지 않습니다).
작품·이미지·모델·metadata의 권리는 작가 또는
권리자에게 남고 별도의 asset rights manifest를 따릅니다. 코드 라이선스가
사용자 작품에 적용되거나 재배포 권한을 자동으로 부여하지 않습니다.
