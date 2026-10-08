# 공개 Viewer와 점진적 작품 로딩

상태: 제한된 GLB/PNG Viewer 구현과 실제 production Chromium 검증 완료. 보행·오디오·실물 모바일 지원은 후속 단계이며, 아래 측정은 모든 성능 목표의 통과 선언이 아니다.

Studio에서 명시적으로 공개한 전시 URL을 열면 공개 snapshot의 공간과 승인된 GLB/PNG 전시용 bytes를 사용한다. 비공개 draft나 Capture 구현을 조회하지 않는다. 입구와 같은 방의 가까운 배치부터 최대 네 작품을 요청하고, 남은 작품은 **다음 작품 불러오기**로 요청한다. 실제 작품이 도착하기 전의 치수 bounds는 상세 모델이나 LOD로 간주하지 않는다.

**Viewer 품질**은 자동·절약·균형 중 선택한다. 자동은 화면 폭768px 미만 또는 보고된 기기 메모리4GiB 이하에서 절약 예산을 선택한다. 브라우저가 기기 메모리를 보고하지 않으면 화면 폭을 사용한다. 이 선택은 기기의 실제 메모리 측정이나 지원 보증이 아니다.

| 예산 | 절약 | 균형 |
| --- | ---: | ---: |
| 동시 작품 요청 | 2 | 3 |
| 화면 pixel ratio 상한 | 1 | 1.5 |
| 작품 texture 최대 변 길이 | 512 | 2048 |
| 작품 triangle 상한 | 20,000 | 100,000 |
| encoded+decoded resource 추정 cache | 32MiB | 96MiB |

입구 품질은 서버가 생성한 작은 실제 모델·이미지를 선택한다. **불러온 작품 상세 품질**은 현재 예산 안에서 full variant를 요청한다. 예산에 맞는 variant가 없으면 오류와 목록/bounds를 유지한다. 모든 작품을 full 품질로 동시에 표시할 수 있다는 뜻은 아니다. **실패한 작품 다시 시도**, **작품 불러오기 취소**, **3D 다시 시작**으로 실패와 중단을 처리한다. 그래픽을 사용할 수 없으면 목록과 keyboard 조작을 사용한다. 보행·충돌은 후속 단계다.

## Variant 계약과 권리

선택적 Artwork extension `org.exhibitos.viewer/lod` version1은 primaryAssetId에 대응하는 full 하나와 선택적 coarse 하나를 참조한다. 각 variant는 공개 asset inventory의 UUID와 detail, GLB의 triangles 또는 PNG의 textureSize를 가진다. Coarse는 full보다 metric과 실제 bytes가 모두 작아야 한다. 구조 schema는 [viewer-lod.schema.json](../contracts/viewer-lod.schema.json)에 있으며, inventory 참조·primary·MIME·role·크기 비교는 추가 domain 검사다. 이 extension이 없는 이전 snapshot도 유지하되 renderer는 실제 decoded resource 예산을 검사한다.

PNG는 전시용 watermark가 적용된 qualified bytes에서 만들고, GLB coarse는 static geometry를 실제로 단순화한다. 원본 다운로드·export 권한은 이 공개 표시 권한과 별개다. 서버는 full/coarse 각각의 현재 승인·작품/asset 표시 권리·만료·공개 상태를 검사한다. 수신한 bytes의 원격 삭제나 DRM을 보장하지 않는다.

브라우저는 publication revision, MIME, 선언된 크기와 SHA-256을 확인하고 선언 크기를 넘는 stream을 취소한다. API와 작품 bytes는 no-store이며 offline artwork 보관을 제공하지 않는다. Renderer/session 안의 임시 재사용도 공개 availability를 재확인한다. Decoded geometry/texture 추정치와 전송 bytes는 서로 다른 예산이며, 이 수치는 실제 tab/process working set을 대신하지 않는다.

## 검증과 운영 한계

GLB child process의 V8 heap128MiB·timeout8초는 native/WASM RSS의 강제 한도가 아니다. Full metric은 coarse 생성 성공 여부와 독립적으로 측정하여 단순화 실패가 기기 예산을 우회하지 않도록 한다. 생성 실패·hash 오류·권리 철회는 성공한 LOD로 표시하지 않는다.

실제 reference scene과 cold/warm·60초 render 측정 정의는 [Viewer 측정 protocol](performance/viewer-protocol.md)을 따른다. 실제 [측정 결과](performance/viewer-baseline.md)는 source commit과 raw samples를 보존한다. Foundation baseline은 Viewer 성능 결과가 아니다. 물리적 iPhone/GPU 및 mobile working-set 검증은 해당 기기와 측정 근거가 있을 때만 지원 matrix에 반영한다. 공개 snapshot/variant의 DB metadata와 object bytes는 Git bundle backup에 포함되지 않으며 [storage 복원 절차](storage.md)의 일관된 DB/blob backup이 필요하다.

GLB previews keep the imported metre-space geometry. The artwork's positive metadata dimensions are independent assertions, not a request to fit or stretch GLB bounds. Detail and exhibition previews anchor a separate wrapper at the measured geometry centre, preserving loaded GLTF node transforms and vertex/index/normal bytes; approved artifact, placement and room transforms are applied once in that order. Valid planar geometry retains its zero extent. Camera framing uses measured extent/aspect rather than adding mesh thickness. The bounded display profile rejects non-finite, empty/entirely degenerate, smaller-than-one-micrometre or over-10,000-metre geometry with a text alternative.

Import `scaleMeters` is retained in server records; it is not currently projected as an additional OES asset transform. OES units are metres and an explicit historical scale conversion is already baked into the asset. Preview code therefore does not apply an inferred second scale from that record or metadata dimensions. Nonidentity `artwork.transform` uses the explicit [ADR0022](adr/0022-artifact-display-affine.md) profile: model `R · P · A · T(-center) · node · vertex`, annotation `R · P · A · q`, centered image plane `R · P · A`. Detail retains A while camera fit and interactive yaw pivot around its transformed centre. Annotation coordinates remain artwork-local centred metres, and declared dimensions continue to govern annotation/placement metadata bounds independently of measured GLB extent.

`npm run test:metric-previews` is an explicit actual Chromium React qualification using independent public planar-textured and volumetric synthetic fixtures with intentionally mismatched dimension assertions. It checks Geometry/Detail rendering, nonempty canvas pixels, rotation/zoom, narrow-aspect clipping, centred annotation coordinates and synthetic publication revocation with bounded resource cleanup. It uses existing browser binaries and dependencies; it does not prove server authorization, physical scale/colour accuracy, or complete UV/LOD quality acceptance. `npm run test:metric-previews -- --artifact-pose` adds independent noncommuting translation/rotation/nonuniform-scale goldens, transformed image rendering and centered annotation checks. Shared numeric and actual Rapier/server tests separately cover affine navigation proxies, continuous thin/grazing sweeps, Float32 bounds and refusal without altering approved CMS/OEX snapshots. These remain declared-dimension navigation proxies, not measured physical mesh collisions or identical solver dynamics.
