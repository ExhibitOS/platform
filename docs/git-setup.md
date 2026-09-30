# Git 설정 및 GitHub 연결

## 로컬 설정

- 기본 브랜치: `main`
- 작성자: 기존 Git 작성자 설정을 이 저장소에 고정
- `pull.ff=only`: pull 시 자동 merge를 만들지 않음
- `push.default=simple`: 현재 브랜치의 같은 이름 upstream으로 push
- GitHub HTTPS 인증: 이 저장소에서 `gh auth git-credential` 사용
- `.gitignore`: 로컬 secret, 비공개 Capture 디렉터리, dataset, build output, infrastructure state 제외
- `.gitattributes`: 텍스트 정규화 및 바이너리 자산 구분

Git 설정은 이 저장소에만 적용합니다. 원격 연결 및 GitHub 저장소 생성은 아직 수행하지 않았습니다.

## 사용자가 다시 로그인

터미널에서 실행합니다.

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth status
```

로그인 뒤 실제 GitHub 계정, 조직 권한, 조직명, 저장소 존재 여부를 확인하고 `origin`을 연결합니다. 문서의 가칭 `ExhibitOS/platform`을 검증 없이 원격으로 등록하지 않습니다.

GitHub 저장소가 생성되면 해당 저장소의 HTTPS clone URL을 사용합니다.

```sh
git remote add origin <확인된-HTTPS-clone-URL>
git push -u origin main
```

목표 공개 범위는 플랫폼 Public / Capture Private입니다. 초기 저장소를 공개할 시점과 최종 라이선스는 별도로 확정합니다.
