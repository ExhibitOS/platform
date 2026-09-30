# Production 웹 baseline — T00-03

측정일: 2026-10-01. 원자료: [baseline.json](baseline.json).
측정 script: [measure-baseline.mjs](../../scripts/measure-baseline.mjs).

| viewport | cold 실행 | DOM usable median | sample p95* | 최대 transfer |
| --- | --- | --- | --- | --- |
| desktop1440×900 | 5회 | 460.6ms | 465.1ms | 224,451bytes |
| narrow375×812 | 5회 | 448.9ms | 454.3ms | 224,451bytes |

\* nearest-rank p95. n=5이면 sample 최대값이며 production 전체의 p95 추정치가 아니다.
둘 모두 horizontal overflow가 관측되지 않았다. warm cache는 이번 측정에 포함하지
않았으며 cold/warm 결과를 혼합하지 않는다.

## 고정 조건과 재현

- macOS26.2 (build25C56), Darwin kernel25.2.0 arm64, AppleM1/8logicalCPU/8GiB system memory.
- Node24.21.0, npm11.19.0, Playwright1.63.0, headless Chromium153.0.8010.12.
- `npm run build`로 생성한 Vite production dist만 정적 HTTP server에서 제공한다.
  Dev server/HMR 코드는 없다. server는 loopback의 새 port, 무압축 응답이다.
- Chromium CDP network: download/upload10Mbps(1,250,000bytes/s), latency100ms.
  실제 외부 회선 측정이 아닌 browser network emulation이다.
- 매회 freshcontext, browser cache 비활성, service worker 없음, concurrency1,
  deviceScaleFactor1, ko-KR, reduced motion, CPU throttle 없음.
- 첫 animation frame에서 h1이 layout상 보이고 연결 button이 활성화되고
  status가 존재하는 시점을 DOM usable로 기록한다. API 연결 성공 시간과는 다르다.
- Navigation/Resource Timing의 transferSize 합산은 HTTP overhead를 포함한다.
  화면에 필요한 HTML/JS/CSS body 합계223,551bytes. 실제 배포 압축 설정과 다르다.
- production file의 경로·byte·SHA-256과 개별10회 DOM/load/transfer 값을 JSON에
  기록한다. host background 부하를 완전히 통제하지 않았으므로 소수점 차이를
  성능 개선으로 해석하지 않는다.

```sh
nvm use
npm ci
npx playwright install chromium
npm run build
npm run measure:baseline
```

nvm을 쓰지 않으면 설치된 Node bin을 `NODE_RUNTIME_BIN`으로 지정하고 PATH에
추가한다. machine별 user home 경로는 문서나 실행 script에 고정하지 않는다.

## Fixture와 적용 한계

현재 측정 fixture는 foundation 연결 화면이다. Gallery GLB/image는 아직 로드하지
않으므로 아래 spec의 synthetic assets를 이 수치에 포함했다고 주장하지 않는다.
기존 작가 작품을 사용하지 않은 별도 재배포 가능 fixture는
[ExhibitOS/spec](https://github.com/ExhibitOS/spec)의 `fixtures/synthetic/`에서
관리하고 원본 권리와 hash를 그 저장소의 manifest로 검증한다.

| 준비된 synthetic asset | bytes | SHA-256 |
| --- | --- | --- |
| sculpture.glb | 1,516 | 1e4e53565fdbc5a71b1aaa83d6b25df6e8025add2f08b35fdca20475fbbca460 |
| painting.png | 196,960 | 33035fadc694f8a64d89d07425a2ed0babb9352208cf34aab657ed5922a55fe9 |

이 목록은 공유된 fixture 검증값이며 platform build의 필수 dependency가 아니다.
최종 fixture commit 및 scene 계약 검증은 spec의 기록을 따른다. 플랫폼은
operations/private Capture 없이 독립적으로 build/검사한다.

기획의 usable5초/초기15MB는 **gallery scene 목표**다. 이 작은 페이지의 결과로
scene 게이트를 충족했다고 보고하지 않는다. 지원 GPU, 60FPSdesktop/30FPSmobile,
400MBmobile, 실물 touch/모바일memory, frame trace와 API metadata300ms는 아직
측정하지 않았다. [지원 matrix](support-matrix.md)는 tested와 후보를 구분한다.
P04에서 최소1방/조각10/회화10/조명4의 고정 scene을 구현해 asset hash와 physical
units를 연결하고 entrance/warm/cold/60초frame trace를 별도로 측정해야 한다.

## CI와 비용

수동 workflow와 최소 contents:read 권한을 유지하고 npm cache 저장을 사용하지
않는다. 동일 workflow/ref 실행은 새 실행으로 취소할 수 있다. hosted Ubuntu
실행은 별도 billing/무료실행조건 확인 후 수행하며 이 macOS 측정으로 대체해
인증하지 않는다. 현재 측정은 무료 로컬 실행이다.
