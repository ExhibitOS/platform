# 저장소 구성 계획

사용자가 제공한 `open-exhibition-project-plan.md`와 `exhibitos-private-capture-github-architecture.md`의 설계를 요약합니다. 두 문서는 Draft/Proposal이며, 아래 표는 목표 구조입니다. 현재 `ExhibitOS`는 GitHub 사용자 계정이며, 조직은 아직 구성하지 않았습니다.

2026-10-01 기준 아래 MVP 저장소 7개를 모두 생성했습니다. 현재 모두 Private이며 기본 브랜치는 `main`입니다. 공개 예정 저장소의 Public 전환은 공개 시점과 라이선스가 확정된 뒤 진행합니다. Capture 저장소는 비공개로 유지합니다.

## MVP 저장소

프로젝트 총괄과 유지보수는 별도 비공개 [operations](https://github.com/ExhibitOS/operations) 저장소에서 관리합니다. 에이전트 작업 지침, 명령 사용법, 운영 결정, Git 백업·복원 도구를 포함합니다. 제품의 빌드 의존성으로 연결하지 않습니다. 기존 로컬 구성에서 `operations/`는 독립 Git 저장소이며 platform의 `.gitignore`로 제외합니다.

| 저장소 | 목표 공개 범위 | 역할 |
| --- | --- | --- |
| [platform](https://github.com/ExhibitOS/platform) | Public | Studio, CMS, Viewer, Runtime, API, Realtime |
| [spec](https://github.com/ExhibitOS/spec) | Public | OES, OEX, OED 및 artifact contract |
| [manager](https://github.com/ExhibitOS/manager) | Public | 설치, 실행, 업데이트, 백업 관리 |
| [deployment](https://github.com/ExhibitOS/deployment) | Public | Generic SSH, OpenTofu, cloud adapters |
| [docs](https://github.com/ExhibitOS/docs) | Public | 사용자 및 개발자 문서 |
| [capture-ios](https://github.com/ExhibitOS/capture-ios) | Private | iPhone Capture 앱 |
| [capture-processing](https://github.com/ExhibitOS/capture-processing) | Private | 비공개 reconstruction 및 processing |

현재 로컬 저장소는 `platform`에 연결되어 있습니다. 추가 저장소 6개는 README로 초기화했으며 아직 로컬에 clone하지 않았습니다. 이곳의 `docs/`에는 플랫폼 관련 문서를 두고, 프로젝트 공통 문서는 별도 `docs` 저장소에서 개발합니다. 다른 저장소의 소스는 이 저장소에 중첩하지 않습니다.

`templates`, `examples`, `capture-pipeline`, `capture-ml`, `capture-datasets`, `capture-internal-tools`는 별도 관리가 필요해지는 시점에 분리합니다. 현재는 MVP 범위에 맞춰 저장소 수를 제한합니다.

기획 문서의 초기 monorepo 예시와 저장소 아키텍처 문서의 분리안은 서로 다릅니다. Git 준비에는 공개/비공개 경계가 명확한 분리안을 반영하며, 앱 내부 디렉터리와 빌드 도구는 구현 시 결정합니다.

## 의존 관계

```text
Public Spec → Public Platform
Public Spec → Private Capture → Artwork Artifact → Public Platform
```

Platform은 공개 규격과 GLB, preview, metadata, dimensions, rights, provenance를 읽습니다. Capture의 내부 알고리즘, SDK, 저장소, 빌드 서버가 플랫폼 실행의 필수 조건이 되어서는 안 됩니다.

원본 사진, depth, camera poses, ML models, proprietary datasets는 공개 Git에 저장하지 않습니다. `.gitignore`는 실수로 추가하는 것을 줄이기 위한 규칙이며 접근 제어나 비공개 저장소를 대체하지 않습니다.

## Git 운영

기본 브랜치는 `main`, 작업 브랜치는 `codex/<작업명>`을 사용합니다. 원격은 `https://github.com/ExhibitOS/platform.git`이며, 로컬 `main`은 `origin/main`을 추적합니다. GitHub의 조직과 팀, branch protection, CODEOWNERS, CI, 라이선스는 구현과 운영 주체가 확정될 때 구성합니다.
