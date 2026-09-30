# 저장소 구성 계획

사용자가 제공한 `open-exhibition-project-plan.md`와 `exhibitos-private-capture-github-architecture.md`의 설계를 요약합니다. 두 문서는 Draft/Proposal이며, 아래 GitHub 저장소는 생성된 저장소 목록이 아닌 계획입니다. `ExhibitOS` 조직명도 가칭입니다.

## MVP 저장소

| 저장소 | 목표 공개 범위 | 역할 |
| --- | --- | --- |
| platform | Public | Studio, CMS, Viewer, Runtime, API, Realtime |
| spec | Public | OES, OEX, OED 및 artifact contract |
| manager | Public | 설치, 실행, 업데이트, 백업 관리 |
| deployment | Public | Generic SSH, OpenTofu, cloud adapters |
| docs | Public | 사용자 및 개발자 문서 |
| capture-ios | Private | iPhone Capture 앱 |
| capture-processing | Private | 비공개 reconstruction 및 processing |

현재 로컬 저장소는 `platform`의 시작점으로 준비합니다. 별도 저장소가 생기기 전까지 이곳의 `docs/`에는 플랫폼 관련 문서를 둡니다. 다른 저장소의 소스는 이 저장소에 중첩하지 않습니다.

기획 문서의 초기 monorepo 예시와 저장소 아키텍처 문서의 분리안은 서로 다릅니다. Git 준비에는 공개/비공개 경계가 명확한 분리안을 반영하며, 앱 내부 디렉터리와 빌드 도구는 구현 시 결정합니다.

## 의존 관계

```text
Public Spec → Public Platform
Public Spec → Private Capture → Artwork Artifact → Public Platform
```

Platform은 공개 규격과 GLB, preview, metadata, dimensions, rights, provenance를 읽습니다. Capture의 내부 알고리즘, SDK, 저장소, 빌드 서버가 플랫폼 실행의 필수 조건이 되어서는 안 됩니다.

원본 사진, depth, camera poses, ML models, proprietary datasets는 공개 Git에 저장하지 않습니다. `.gitignore`는 실수로 추가하는 것을 줄이기 위한 규칙이며 접근 제어나 비공개 저장소를 대체하지 않습니다.

## Git 운영

기본 브랜치는 `main`, 작업 브랜치는 `codex/<작업명>`을 사용합니다. 실제 조직과 저장소가 확인되면 원격을 연결합니다. GitHub의 팀, branch protection, CODEOWNERS, CI, 라이선스는 구현과 운영 주체가 확정될 때 구성합니다.
