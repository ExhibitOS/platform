# ExhibitOS / Open Exhibition

작품과 전시 공간을 제작하고, 관람하고, 배포하고, 보존하기 위한 디지털 전시 인프라입니다.

현재 이 저장소는 공개 플랫폼 개발을 위한 초기 Git 기반만 준비되어 있습니다. 실행 가능한 애플리케이션이나 배포판은 아직 없습니다.

## 저장소 경계

공개 플랫폼은 Studio, Viewer, Runtime, CMS, API, Realtime을 포함합니다. 비공개 Capture 구현을 가져오거나 private submodule에 의존하지 않습니다.

Capture iOS 앱과 processing pipeline은 별도 비공개 저장소에서 개발하며, 공개 OES artwork contract를 통해 결과물을 전달합니다. OES/OEX/OED는 현재 프로젝트에서 제안하는 규격입니다.

저장소 분리 계획은 [architecture.md](docs/architecture.md), Git 설정 및 인증 이후 절차는 [git-setup.md](docs/git-setup.md)를 참고하세요.

## 개발 시작점

첫 개발 목표는 OES artwork contract 정의, GLB import, 기본 Viewer와 전시 공간 연결입니다. 실제 작품 원본과 Capture dataset은 별도 비공개 object storage에서 관리합니다. 공개 예제에는 재배포 가능한 데이터만 사용합니다.

## 라이선스

오픈소스 공개를 목표로 하며, 구체적인 라이선스는 아직 확정되지 않았습니다. 원문 문서에 제시된 AGPLv3, MIT/Apache-2.0, CC0는 검토안입니다. 작품의 권리는 작가 또는 권리자에게 남습니다.
