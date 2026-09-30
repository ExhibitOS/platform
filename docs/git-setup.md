# Git 설정 및 GitHub 연결

## 로컬 설정

- 기본 브랜치: `main`
- 작성자: 기존 Git 작성자 설정을 이 저장소에 고정
- `pull.ff=only`: pull 시 자동 merge를 만들지 않음
- `push.default=simple`: 현재 브랜치의 같은 이름 upstream으로 push
- GitHub HTTPS 인증: 이 저장소에서 `gh auth git-credential` 사용
- `.gitignore`: 로컬 secret, 비공개 Capture 디렉터리, dataset, build output, infrastructure state 제외
- `.gitattributes`: 텍스트 정규화 및 바이너리 자산 구분

Git 설정은 이 저장소에만 적용합니다.

## 현재 연결 상태

- 확인 날짜: 2026-10-01
- GitHub 계정: `ExhibitOS` (사용자 계정)
- 저장소: `ExhibitOS/platform`
- 현재 공개 범위: Private (초기 준비 단계)
- origin: `https://github.com/ExhibitOS/platform.git`
- upstream: `main` → `origin/main`

인증을 확인한 뒤 저장소 생성과 초기 push를 완료했습니다. 이후 커밋은 `git push`로 올릴 수 있습니다.

## 사용자가 다시 로그인

터미널에서 실행합니다.

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth status
```

인증이 만료되면 위 명령으로 다시 로그인합니다. 현재 저장소는 확인된 `ExhibitOS` 사용자 계정에 연결되어 있습니다.

다른 환경에서 개발하려면 다음 명령으로 복제합니다.

```sh
gh repo clone ExhibitOS/platform
```

목표 공개 범위는 플랫폼 Public / Capture Private입니다. 초기 저장소를 공개할 시점과 최종 라이선스는 별도로 확정합니다.
