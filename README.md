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
현재 개발 기기의 runtime은 다음 경로에 있으며 system Node는 변경하지 않습니다.

```sh
export PATH="/Users/jonghojung/.nvm/versions/node/v24.21.0/bin:$PATH"
node --version
npm --version
npm ci
```

다른 기기에서는 `.nvmrc`의 버전을 설치하고 같은 명령을 실행합니다. 위 경로는
현재 macOS 환경 예시이며 CI와 product code에 사용자 경로 의존성이 없습니다.
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

## 라이선스

오픈소스 공개를 목표로 하며, 구체적인 라이선스는 아직 확정되지 않았습니다. 원문 문서에 제시된 AGPLv3, MIT/Apache-2.0, CC0는 검토안입니다. 작품의 권리는 작가 또는 권리자에게 남습니다.
