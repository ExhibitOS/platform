# ADR 0001 — 독립적인 웹/API 개발 기반

상태: 채택 (T00-02). 날짜: 2026-10-01.

## 결정

npm workspaces로 `apps/web`와 `apps/api`를 관리한다. 웹은 React/Vite,
API는 Fastify, 양쪽은 TypeScript를 사용한다. SSR, DB, 인증, 3D 및 realtime은
이번 foundation의 산출물이 아니며 각각의 후속 작업에서 도입한다.

| 도구 | exact 버전 | 라이선스/근거 |
| --- | --- | --- |
| Node.js | 24.21.0 | MIT, 설치된 LTS runtime |
| npm | 11.19.0 | Artistic-2.0, 해당 runtime에 포함 |
| TypeScript | 6.0.3 | Apache-2.0 |
| React / React DOM | 19.3.0 | MIT |
| Vite / React plugin | 8.3.1 / 6.1.1 | MIT |
| Fastify | 5.12.5 | MIT |
| ESLint / typescript-eslint | 10.11.0 / 8.71.0 | MIT |
| Vitest | 5.0.3 | MIT |
| Playwright test | 1.63.0 | Apache-2.0 |

선택은 공식 npm registry `npm view <package> version engines license
peerDependencies`와 최소 설치/검사로 확인한다. 직접 의존성은 exact로 쓰고
전이 의존성은 `package-lock.json`으로 고정한다. TypeScript 최신 7.0.2는
현재 typescript-eslint의 `>=4.8.4 <6.1.0` 지원 범위를 벗어나므로 6.0.3을
선택했다. 프로젝트 자체 라이선스 결정과 의존성 라이선스는 별개다.

## 비교와 선택 이유

React 공식 문서는 framework가 필요 없는 경우 Vite 기반 구성을 안내한다.
이 제품은 local-first editor와 정적 browser runtime을 요구하므로 SSR
framework보다 별도 SPA/API가 시작 범위를 작게 유지한다. 향후 public
metadata SSR이 필요하면 API 계약과 독립 build를 유지하며 재평가한다.
Fastify는 JSON schema response와 socket을 열지 않는 HTTP injection test를
지원한다. API 시작과 app factory를 분리해 재현 가능한 health/404 검증을 한다.
npm은 현재 Node 배포에 포함되며 workspace linking과 lockfile을 제공하므로
추가 package manager가 필요 없다. pnpm/Nx/Turborepo는 실제 workspace 성능
문제가 확인되면 검토한다. 이 비교는 다른 후보의 구현 성능을 측정한 주장이
아니며 선택한 후보의 실제 최소 build/test를 검증한 결정이다.

## 실행과 경계

Node20은 공식 지원 종료 상태이고 Vitest5에도 부족하다. `.nvmrc`는 지원
LTS24 exact patch를 고정한다. OS의 system Node를 바꾸지 않는다. 전역
도구 설치나 private 저장소 clone 없이 `npm ci`와 README 명령으로 검증한다.
health는 process liveness만 나타내고 DB/storage readiness나 인증 완료를
보장하지 않는다. 기본 API bind는 loopback이다. 개발 proxy만 웹/API를
연결하며 실제 network deployment 및 권한은 후속 단계의 검사 대상이다.

CI는 동일 명령과 공개 synthetic 테스트만 사용하는 수동 dispatch 설정이다.
GitHub billing 잔여량/예산 확인 전에는 자동 trigger와 hosted 실행을 허용하지
않는다. 로컬 CI-equivalent 검증은 hosted CI 실행 완료를 의미하지 않는다.

## 공식 자료

- [React: build from scratch](https://react.dev/learn/build-a-react-app-from-scratch)
- [Vite: runtime requirements](https://vite.dev/guide/)
- [Fastify: testing and injection](https://fastify.dev/docs/latest/Guides/Testing/)
- [Fastify: LTS policy](https://fastify.dev/docs/latest/Reference/LTS/)
- [npm: workspaces](https://docs.npmjs.com/cli/using-npm/workspaces/)
- [Node: release schedule](https://github.com/nodejs/Release)
- [Node: end of life](https://nodejs.org/en/about/eol)
- [npm registry](https://registry.npmjs.org/)

버전 업데이트는 지원 범위·lockfile·전체 검사를 함께 변경한다. build 도구
버전은 성능 예산이나 전체 desktop/mobile 지원 인증을 대신하지 않는다.
