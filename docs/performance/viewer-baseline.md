# Viewer 실제 측정 결과

2026-10-01, source `8b6ccc883f1b9e50011983d89eb9145ec6e82491`, clean public checkout에서 root가 검사했다. [Raw JSON](viewer-baseline.json)은20개 entrance samples, 요청별 bytes/status/cache,40asset inventory/hash와 두60초 실제 renderer.render trace를 보존한다. [Protocol](viewer-protocol.md)의 기준은 변경하지 않았다.

환경: macOS26.2/Darwin25.2.0 arm64, AppleM1, Node24.21.0/npm11.19.0, Chromium153.0.8010.12. Headless ANGLE/Vulkan SwiftShader software renderer이며 물리 GPU나 실물 모바일이 아니다. Desktop1440×900, narrow390×844, deviceScale1/reduced-motion reduce;10Mbps/100ms를 Chromium network emulation으로 적용했다. Warm은 같은 anonymous context의 app HTTP cache 범위이고 metadata/artwork는 no-store이며 service worker가 없다. Warm artwork offline 보관이나 cross-session 재사용으로 해석하지 않는다.

| 실제 결과 | Desktop | Narrow viewport |
| --- | ---: | ---: |
| Cold entrance 최대값(5회 nearest-rank p95) | 2.788s | 2.899s |
| Warm entrance 최대값(5회 nearest-rank p95) | 3.077s | 2.844s |
| 최대 초기 app+metadata+entrance 전송 | 1,766,385B | 1,690,292B |
| 실제60초 renderer 평균 FPS | 52.63 | 59.07 |
| Frame interval p95 | 20.2ms | 18.4ms |
| Renderer call duration p95 | 0.3ms | 0.3ms |
| JS used heap proxy | 17.1MB | 16.1MB |

Cold/warm entrance5초·초기15MiB 목표는 이 samples에서 통과했다. Desktop60FPS 목표는 **미달**이며 기준이나 samples를 바꾸지 않았다. Narrow30FPS proposal은 이 software viewport에서만 넘어섰고 mobile30FPS 지원을 입증하지 않는다. 샘플5회 최대는 production population p95 추정이 아니다. 소프트웨어 renderer와 host scheduling 변동을 포함한 실제 결과이며 기기/GPU별 최적화·검증은 후속 gate다. 기준 mobile tab working set400MB는 **미검증**이다.

실제 scene는 방1/조각10/회화10/조명4이다. 입구에서4작품을 decode/render하고16작품을 deferred 상태로 유지하여 full gallery preload를 요구하지 않았다. 다음 네 묶음으로20개 실제 assets/placements를 표시했고 scene30,786triangles를 실제 draw했다. 측정 trace는 qualified coarse 품질이며 모든 작품의 full 품질 동시 표시가 아니다. Decoded geometry/texture estimate 약14.72MB, encoded cache1.013MB, combined15.736MB는32/96MiB profile 안에 있었다. 추정치는 native/WASM/GPU driver/process RSS를 포함하지 않는다. Full 요청은 기기 예산 안에서만 upgrade하며 compact는 적합한 coarse를 유지한다.

Dense GLB full513,324B/27,654triangles→coarse75,728B/3,076triangles, qualified PNG full182,357B/2048→coarse25,598B/512를 실제 생성했다. Materials/physical bounds 보존과 coarse refusal 시>100k full-only metric, invalid accessor와 child timeout을 격리 worker3검사로 확인했다. 모든 source·qualified hashes는 raw inventory에 기록한다. 원본 artwork나 Capture dataset은 사용하지 않았다.

Root `npm ci`, `npm run check`(36unit/8contracts/typecheck/lint/build/10runtime notices), 분리 포트의 `npm run test:e2e`3검사, 실제 child3검사 및 `node scripts/test-viewer.mjs`14groups가 exit0이다. Viewer 검사는 missing/corrupt/network recovery, cancel/retry, GPU-loss event/list fallback, uppercase-reference underclaimedGLB/PNG 거부·qualified fallback, combined budget·cache reuse·disposal, current rights revoke, qualified full-only publication과 synthetic PostgreSQL40variant binding/hash 복원을 포함한다. Event injection은 물리 GPU-loss 재현이 아니다. DB 복원 검사는 별도 DB metadata와 retained blob hashes이며 production DB/blob 복원지점이 아니다.

공유 renderer 회귀는 직전eae7c2c에서 geometry5, CMS26(API 및 production browser16그룹 포함), publication16 실제 검사를 통과했다. 그 뒤 변경은 public metric case/dimension 방어 및 관련 browser 검사이며 finalhead 전체check/Viewer/E2E를 다시 실행했다. 초기 E2E 시도는 분리 Vite config 인수 전달 오류로 timeout했고 임시 검사 설정을 수정한 뒤 final E2E3PASS; 사용자 기존 서버는 건드리지 않았다. Source reviewer는 final8b6ccc8의 별도 read-only 승인만 제공했으며 root 검사를 대신하지 않는다.
