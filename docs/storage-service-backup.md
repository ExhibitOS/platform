# 서비스 데이터 백업과 새 환경 복원

이 운영자 도구는 PostgreSQL 전체 `public` 서비스 metadata와 blob backend의
**전체 key 목록**을 함께 백업합니다. 참조된 작품, 공개 전시, PCM 오디오,
OEX staging·cleanup, 고정 전시와 보존 runtime, trash·quarantine 및 tenant 목록에
없는 orphan도 포함합니다. 모든 객체의 실제 크기와 SHA-256을 기록하고,
필수 참조·migration·schema·table contents를 검증합니다. Git bundle이나
OEX/.oef 하나로 계정·작업 상태·전체 서비스 데이터를 복원할 수는 없습니다.

백업은 AES-256-GCM으로 파일마다 별도 nonce를 사용해 암호화합니다. 암호화된
manifest도 별도로 인증하며, DB dump·blob·runtime·설정은 백업 ID와 파일 역할에
묶여 검증됩니다. 소유자만 읽는 새 디렉터리와 파일을 만들고 기존 사본을
덮어쓰지 않습니다. 암호화 key는 백업과 다른 경로에 보관해야 합니다.

## 사전 준비

1. README의 Node24.21.0/npm11.19.0을 선택하고 `npm ci && npm run build`를
   완료합니다. 이 도구는 빌드된 공개 storage/API 패키지를 사용합니다.
2. 신뢰할 운영자가 원본 DB와 blob backend의 관리 권한을 준비합니다.
   DB role은 전체 서비스 row와 `pg_control_system()`을 읽고 snapshot을
   export할 수 있어야 합니다. 브라우저 로그인이나 tenant API 권한과 다릅니다.
3. 모든 HTTP writer, CMS/Studio/OEX/freeze worker와 외부 SQL/object 관리자를
   중지합니다. 이미 진행 중인 작업도 종료/정지했는지 확인합니다. 정지한
   프로세스와 시각을 개인 운영 기록에 남깁니다. 협조하지 않는 외부 writer가
   있는 상태에서 `--quiesced`를 사용하지 마세요.
4. PostgreSQL18.6과 호환되는 `pg_dump`/`pg_restore`를 준비합니다. 원본보다
   오래된 dump 도구를 쓰지 않습니다. native 도구가 없다면 이미 실행 중인
   승인된 PostgreSQL 컨테이너 이름을 지정할 수 있습니다. 도구는 컨테이너를
   만들거나 pull·삭제하지 않습니다.
5. 암호화 key·백업·복원 검사 디렉터리를 각각 분리합니다. 암호화된 백업도
   개인 정보이므로 private storage에만 둡니다. 검증/복원 작업 공간은 복호화된
   DB와 설정을 포함하므로 추가로 격리합니다.

새 key 디렉터리를 mode0700으로 만든 뒤 다음 명령을 실행합니다. 경로는
운영자가 정한 실제 private 경로이며 아래 변수는 예시 이름입니다.

```sh
BACKUP_KEY_DIRECTORY="<새 private key 디렉터리의 절대 경로>"
mkdir -m 700 "$BACKUP_KEY_DIRECTORY"
BACKUP_KEY_FILE="$BACKUP_KEY_DIRECTORY/service-backup.key"
node scripts/service-backup.mjs key-init --key-file "$BACKUP_KEY_FILE"
```

key는 32바이트 raw binary이며 mode0600, 단일 regular file이어야 합니다.
기존 key 파일·symlink·hard link·공개 권한의 key는 거부합니다.
key·백업·blob 경로는 symlink를 경유하지 않는 실제 경로를 사용합니다.
macOS의 `/tmp` alias를 사용할 경우 실제 `/private/tmp` 경로를 지정하세요. key 내용은
출력하지 않습니다. 별도 안전한 위치에 key의 복구 사본을 준비하고,
그 사본으로 실제 백업 검증을 수행하세요. key가 없으면 암호화 백업을 복구할
수 없습니다. 새 key를 만들 때 이전 백업용 key를 보존합니다.

## 연결과 포함 범위

비밀값은 private 환경 파일 또는 프로세스 환경에서 제공합니다. URL/password를
명령 인수, PR, Git, 콘솔 출력이나 공유 문서에 붙여넣지 않습니다. 이미 구성된
신뢰할 mode0600 환경 파일을 로드하는 예:

```sh
SOURCE_ENV_FILE="<신뢰할 원본 연결 환경 파일의 절대 경로>"
set -a
source "$SOURCE_ENV_FILE"
set +a
```

`source`는 파일 내용을 실행하므로 자신이 관리하는 환경 파일만 사용합니다.

| 변수 | 의미 |
| --- | --- |
| `DATABASE_URL` | 원본 또는 복원 대상 PostgreSQL 연결 URL. private 환경 값만 허용 |
| `BLOB_ROOT` | filesystem backend의 실제 private 객체 root |
| `BACKUP_BLOB_BACKEND` | `filesystem`(기본) 또는 `s3` |
| `S3_BUCKET` | 이미 준비된 전용 S3 bucket 이름 |
| `S3_ENDPOINT` | 이미 승인된 S3-compatible endpoint. AWS S3는 생략 가능 |
| `AWS_REGION` | 기본 `us-east-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3를 사용할 때 필요한 private 환경 자격 증명 |
| `AWS_SESSION_TOKEN` | 임시 자격 증명의 선택적 token |
| `S3_FORCE_PATH_STYLE` | 호환 서버가 요구할 때만 `1` |
| `FREEZE_RUNTIME_ROOT` | 선택: 검증된 production 웹 dist 전체를 추가 보존 |
| `BACKUP_CONFIGURATION_FILES` | 선택: 논리 이름→private 설정 파일 경로의 JSON object |
| `PG_DUMP_BIN`, `PG_RESTORE_BIN` | 선택: native 실행 파일의 경로 |
| `BACKUP_POSTGRES_CONTAINER` | 선택: PostgreSQL 서버가 있는 기존 Docker 컨테이너 이름 |
| `DOCKER_BIN` | 선택: Docker CLI 경로 |
| `BACKUP_CONTAINER_PGHOST`, `BACKUP_CONTAINER_PGPORT` | 컨테이너 내부 DB 주소. 기본 loopback/5432 |
| `BACKUP_PG_TIMEOUT_MS` | dump/restore process 제한. 기본 1시간, 최대 24시간 |
| `BACKUP_MAX_DUMP_BYTES` | dump stdout 크기 상한. 기본 32GiB |

S3 mode는 명시적 환경 자격 증명을 요구하며 임의 EC2 metadata 탐색으로
대체하지 않습니다. 기존 bucket의 모든 객체를 나열/읽을 권한이 필요합니다.
새 유료 리소스나 bucket은 이 도구가 생성하지 않습니다.

`BACKUP_CONFIGURATION_FILES`에는 운영에 필요한 환경 설정, freeze 서명 key,
TLS/adapter 설정 등을 운영자가 선택해 포함합니다. 논리 이름은 ASCII
문자·숫자·`_`·`.`·`-`, 파일 하나는 최대1MiB, 최대32개이며 각 원본 파일은
mode0600 regular file이어야 합니다. **백업 암호화 key 자체는 넣을 수 없습니다.**
선택하지 않은 OS/keychain 비밀, PostgreSQL cluster의 global role/password,
외부 bucket 정책·IAM·DNS·TLS·Docker volumes 및 기기 상태는 자동 백업하지 않습니다.

`FREEZE_RUNTIME_ROOT`는 exact public build의 전체 파일 inventory/hash를
검사합니다. 고정 전시에 이미 연결된 runtime은 DB/blob의 일부로 항상
포함되며, 이 변수는 현재 배포할 runtime을 추가 보존합니다. 지정하지 않으면
현재 웹 배포 image는 추가 보존하지 않습니다. 배포 commit/OCI digest와
별도 자격 증명의 복구 위치를 private 운영 기록에 함께 남기세요.

## 일관된 백업 생성

새 백업 디렉터리의 부모만 미리 mode0700으로 준비합니다. `--destination`
자체는 **존재하지 않아야** 합니다. 같은 이름으로 재실행하면 덮어쓰지 않고
거부하므로 실패 후에도 새 이름을 사용합니다.

```sh
BACKUP_PARENT="<이미 준비한 private 백업 볼륨의 절대 경로>"
BACKUP_RUN="$(date -u +%Y%m%dT%H%M%SZ)-$(node -e 'process.stdout.write(crypto.randomUUID())')"
BACKUP_DESTINATION="$BACKUP_PARENT/$BACKUP_RUN"
node scripts/service-backup.mjs create \
  --key-file "$BACKUP_KEY_FILE" \
  --destination "$BACKUP_DESTINATION" \
  --quiesced
```

`--quiesced`는 실제 정지를 대신하지 않는 운영자의 확인입니다. 도구는 전용
DB session에서 exclusive advisory lock82002를 잡고, 그 뒤 repeatable-read
transaction과 exported snapshot을 만듭니다. `pg_dump --snapshot`도 같은
snapshot을 사용합니다. lock은 전체 DB/object inventory 재검사와 암호화 파일
생성이 끝날 때까지 유지합니다. auth lock82003은 이 lock 안에서 요청하지
않습니다. library shared82002를 따르는 writer는 기다리지만, 직접 SQL/object
writer를 자동으로 정지시키지는 못합니다.

Docker mode는 native 도구 대신 `docker exec`를 사용합니다. PG 자격 증명은
`-e PGPASSWORD`처럼 **이름만** 인수에 넣고 Docker CLI의 private 환경에서
전달합니다. dump stdout은 새 private 파일로, restore dump는 stdin으로
전달합니다. URL·password·SQL rows·dump·stderr를 콘솔에 출력하지 않습니다.
실패 출력은 의도적으로 일반적이므로 private 운영 환경/도구·서버 기록을
확인하며 비밀이 든 로그를 공유하지 마세요.

`complete.json`은 성공한 사본의 receipt이고 `manifest.gcm`과 `files/*.gcm`은
암호화 데이터입니다. receipt만 있거나 디렉터리가 존재한다는 이유로 복구
가능하다고 판단하지 않습니다. 반드시 아래 검증을 수행합니다. 실패한 작업의
`writing.json`/`failed.json`과 부분 사본은 남겨 진단하며 자동 삭제하지 않습니다.

## 백업 검증과 복호화

`verify`는 DB/object store에 연결하지 않습니다. 별도의 **새** private 작업
디렉터리에서 manifest와 모든 암호화 파일의 GCM tag, cipher/plain 크기와
SHA-256, closed inventory를 확인합니다.

```sh
VERIFY_DESTINATION="<존재하지 않는 별도 검증 디렉터리의 절대 경로>"
node scripts/service-backup.mjs verify \
  --key-file "$BACKUP_KEY_FILE" \
  --source "$BACKUP_DESTINATION" \
  --destination "$VERIFY_DESTINATION"
```

성공 후 작업 공간의 manifest와 `.plain` 파일은 **복호화된 민감 데이터**입니다.
파일의 논리 역할/객체 key/설정 이름은 private manifest에 기록됩니다. 이 작업
공간을 배포·공유·Git에 추가하지 않습니다. tag/hash/key가 틀리거나 파일이
누락되면 검증 실패입니다. 실패 작업 공간의 부분 plaintext는 신뢰하거나
사용하지 않습니다. 검증은 byte integrity 확인이며, 실제 새 DB/object 환경
복원을 대체하지 않습니다.

## 새 환경 복원과 무결성 확인

1. 원본 source를 보존한 채 **새 PostgreSQL database**와 **새 빈 private
   filesystem root 또는 전용 빈 bucket**을 만듭니다. 원본과 같은 database
   identity, 기존 service relation, object가 있는 대상은 거부합니다.
2. dump owner/ACL의 PostgreSQL role을 별도로 준비합니다. 도구는
   `--no-owner`/`--no-acl`로 권한을 지우지 않습니다. 일반 `pg_dump`는 cluster
   global role 정의/role password를 포함하지 않습니다.
3. 대상에 HTTP server/worker를 아직 시작하지 않습니다. 대상 연결만 들어 있는
   별도 private 환경 파일을 로드하고 source 설정이 남지 않았는지 확인합니다.
4. 아래 `--destination`은 **새 복호화/검증 작업 공간**입니다. blob root와
   다릅니다. 이미 사용한 verify 작업 공간을 재사용하지 않습니다.

```sh
TARGET_ENV_FILE="<새 대상 연결 환경 파일의 절대 경로>"
set -a
source "$TARGET_ENV_FILE"
set +a
RESTORE_WORKSPACE="<존재하지 않는 새 복원 검사 디렉터리의 절대 경로>"
node scripts/service-backup.mjs restore \
  --key-file "$BACKUP_KEY_FILE" \
  --source "$BACKUP_DESTINATION" \
  --destination "$RESTORE_WORKSPACE" \
  --quiesced \
  --fresh-destination
```

S3→filesystem 복원은 대상 환경에서 `BACKUP_BLOB_BACKEND=filesystem`과
새 `BLOB_ROOT`를 지정합니다. 반대 방향도 기존의 승인된 빈 bucket에서만
진행합니다. 도구는 PostgreSQL dump를 error-stop/single transaction으로
복원하고 객체를 immutable put한 뒤, schema/migration checksums·table contents·
전체 object inventory와 참조 hash를 원본 manifest와 다시 비교합니다.
`restored.json`이 생성되고 검증 성공을 보고하기 전에는 대상 환경을 활성화하지
않습니다. 검사 실패 시 source/이전 백업은 보존되고 candidate DB/blob/workspace는
진단용으로 남습니다. 실패 대상은 덮어써서 재시도하지 말고 새 후보를 만듭니다.

runtime/configuration은 DB/object 무결성 비교 뒤 작업 공간의
`runtime/<논리 이름>`과 `configuration/<논리 이름>`에 검증된 plaintext로
복구되며 자동 설치하거나 활성화하지 않습니다. private manifest의 논리 이름을 확인해 새 배포의 올바른 private
경로와 권한으로 복구합니다. signing origin, 관리자 역할, 외부 자격 증명,
TLS/backend 정책, 현재 권리 상태와 중단된 worker lease/cleanup receipt를
확인한 뒤에만 서비스를 켭니다. 복원은 백업 당시의 상태이므로 백업 이후의
권리 철회·신규 데이터·외부 변경을 자동으로 알지 못합니다.

새 후보에서 전시·작품·오디오와 권리 거부, 로그인/profile 분리, freeze 파일의
서명 및 표시 기한, 중단된 작업의 재개를 실제로 확인하고 receipt/검사 시각을
private 운영 기록에 남깁니다. 원본 설치와 원래 자격 증명은 검증과 운영자
전환 결정이 끝날 때까지 rollback용으로 보존합니다.

## 중단, 보존, key rotation

- 기본 dump 상한/시간을 초과하거나 process가 실패하면 완성 receipt를 내지
  않습니다. 필요 시 용량·권한·원본 정지 상태를 확인하고 새 backup path로 다시
  실행합니다. SIGINT/SIGTERM은 PG subprocess를 중단하고 library가 lock을
  해제하도록 전달합니다. SIGKILL/전원 중단은 자동 정리를 보장하지 않습니다.
- 생성 library가 만든 private 일회성 plaintext scratch만 정상 finally에서
  제거합니다. 강제 종료 시 OS 임시 경로의 `exhibitos-backup-private-*`가 남을
  수 있습니다. operator가 소유·역할을 확인한 뒤 개인 자료 정책에 따라
  처리합니다. 이전 백업, 복원 대상, 검증 작업 공간, 실제 서비스 데이터를
  도구가 자동 삭제하지 않습니다.
- 초기 retention은 자동 만료·삭제 없음입니다. 실제 보존 기간·별도 위치 복제·
  추가 복구 실험 일정은 환경의 용량과 프로젝트 비용 한도에 맞춰 운영자가
  정합니다. 이 도구 자체는 스케줄러·새 hosted storage를 만들지 않습니다.
- 새 암호화 key는 새 파일 이름으로 만들고 새 백업에 사용합니다. 이전 key와
  원래 사본을 보존한 채 새 사본의 검증 및 독립 환경 복원을 확인합니다.
  감사된 보존 정책이 확정되기 전에는 기존 사본/key를 폐기하지 않습니다.

지원 범위와 실제 qualification은 [storage 안내](storage.md) 및 기록된 검사
결과와 함께 읽으세요. 단일 개발 환경의 통합 성공을 운영 disaster-recovery SLA,
임의 DB extension/schema, 모든 S3 구현 또는 실물 장치 복구 보장으로 확대하지
않습니다.

## 유지보수 이미지 개발 경로

`Dockerfile.maintenance`는 공개 소스와 고정된 Node24.21/PostgreSQL18.6 base에서
기존 service-backup CLI를 빌드하는 별도 one-shot 이미지다. 일반 Viewer/API
컨테이너의 실행 이미지와 분리하며 PostgreSQL 서버를 시작하지 않는다.
기본 UID1000은 Runtime의 private blob 파일 소유자와 맞춘다. 실제 운영자는
mount의 소유권/권한과 필요한 최소 UID를 확인해야 한다. key는 별도 private
read-only mount, archive/새 복원 대상만 writable mount로 제공한다. Docker
socket과 arbitrary host root를 mount하지 않는다. DB URL/비밀은 trusted 환경
파일로 전달하고 command 인수·로그에 넣지 않는다.

이미지에는 pg_dump/pg_restore18.6과 Node CLI가 들어 있다. 기존 create/verify/
restore 명령·quiesced/fresh-destination 요구·현재 권리/무결성 검사와 실패 시
원본 보존 규칙은 그대로 적용한다. 이미지 생성만으로 Manager UI·backup
adapter·자동 update/rollback이나 production restore가 완료된 것은 아니다.

로컬 Docker Desktop 합성 회귀에서 `BACKUP_CLI_IMAGE=sha256:<검사한 local image ID>`
를 지정해 `node scripts/test-service-backup.mjs`를 실행할 수 있다. 시험은 새로
소유한 fixture 경로와 정확한 검사 runtime의 `/private/tmp` 사본만 mount하고 실제 CLI를 이미지에서
실행한다. private 환경 이름만 Docker 인수로 전달한다. 검사 user는 host private 파일의 UID/GID와 일치시킨다.
선택적 `BACKUP_CLI_DIAGNOSTIC=1`은 시험용 wrapper에서 제한된 BACKUP/허용된 native 오류 code만 출력하며 raw error·비밀은 출력하지 않는다. Host fixture의 loopback
DB/S3 endpoint는 container의 host.docker.internal로 변환하므로 이 경로는
현재 Docker Desktop 검사 전용이며 일반 Linux/Podman 배포 보장과 다르다.
강제 중단 검사는 해당 소유 label을 확인한 CLI 컨테이너만 제거한다.

Freeze의 Spec provenance는 검증된 version/hash 조합을 명시적으로 허용한다.
기존 draft.2 보존 metadata와 현재 draft.3 생성 metadata를 지원하며 version/hash
혼합이나 임의의 신규 artifact는 거부한다. 이것은 기존 signed archive 전체의
새 Runtime replay gate를 대신하지 않는다.

## 배포 파일 보존 (draft2)

`BACKUP_DEPLOYMENT_FILES`는 논리 이름을 `{path,bytes,sha256}`에 연결하는 JSON
object이다. trusted bundle에서 확인한 크기·SHA-256을 사용하고 private 환경 파일로
전달한다. canonical private 단일-link regular file만 허용하며 최대32개/각8GiB이다.
입력 파일은 스트리밍 암호화하고 크기/해시 불일치 시 complete receipt를 만들지 않는다.
키를 artifact로 선택하면 안 된다. CLI는 키와 같은 경로를 거부한다.

배포 파일 포함 시 manifest는 `1.0.0-draft.2`다. 새 reader는 draft1도 읽지만
기존 maintenance image는 draft2를 거부하므로 새 image build/qualification이 필요하다.
새 target의 DB/blob 비교 뒤 `deployment/<논리 이름>`에 파일을 보관한다. 이는 OCI
image trust/import/실행 또는 Manager 전체 복구 완료를 뜻하지 않는다. Manager는
별도로 trusted bundle/image provenance·compatibility를 확인한 뒤 import해야 한다.
키·OCI archives·private runtime.env·복호화 후보는 Git backup에 포함하지 않는다.

## Runtime 이미지까지 포함하는 로컬 복구 검사

새 `Dockerfile.maintenance`는 현재 생산 웹 Runtime 파일도 포함한다. 작성 시
`FREEZE_RUNTIME_ROOT=/opt/exhibitos/apps/web/dist`를 지정할 수 있으며, host 웹
경로가 없더라도 같은 image 안에서 버전/hash 검증된 Runtime을 읽는다. 생산
notices와 Node license도 image에 보존한다. 이전 immutable image는 바뀌지 않는다.

`test-deployment-image-backup.mjs`는 운영 복원 도구가 아닌 실제 합성 qualification
검사다. Node24.21.0/npm11.19.0으로 build한 독립 source에서 실행한다. 다음 image는
시험 전용으로 새로 만들고 다른 설치에 연결하지 않는다. source image의 정확한
태그/digest·qualification label·사용 container 없음·충분한 디스크를 검사한 뒤에만
시험용 image catalog entry를 제거한다. 다른 image/data/cache를 prune하지 않는다.

```sh
docker build -f Dockerfile.local \
  --label exhibitos.qualification=runtime-recovery-e033f3f \
  --tag exhibitos-local:recovery-e033f3f --iidfile /private/tmp/runtime-recovery.iid .
BACKUP_RECOVERY_IMAGE="$(cat /private/tmp/runtime-recovery.iid)" \
  node scripts/test-deployment-image-backup.mjs
```

이 검사는 PostgreSQL dump·전체 row/blob inventory·관리자 credential·서명 설정·
실제 Runtime Docker archive를 암호화하고 원래 DB/blob/archive 경로와 image catalog
entry가 unavailable인 상태에서 새 DB/blob/config/image로 복원한다. 원래 image ID·
파일 hash·private mode와 실제 readiness/web/기존 관리자 로그인을 확인한다.
단일 Docker 엔진에 남은 content/build cache까지 없애는 재해 복구 검사는 아니다.
새 엔진, 실제 작품/전시 전체, production, Windows/Podman, Manager native UI,
signed update/rollback은 별도 qualification을 유지한다. 시험 key는 메모리에만
존재하며 보존된 합성 archive를 운영 복원 지점으로 사용하면 안 된다.

실패 후보와 이전 archive/데이터는 자동 삭제하지 않는다. 정상 종료 시에는 정확한
owner label을 확인한 이번 disposable DB/Runtime container와 연결 anonymous
volume만 정리하며, 복원 image와 private report/workspace는 보존한다. 강제 종료는
owner label로 별도 조사한다. Docker29의 local multi-platform digest를 처리하는
시험이므로 다른 image store 방식에서는 precondition이 실패할 수 있다.

## 업데이트 전 원본 데이터의 읽기 전용 재검사

`check-source-inventory`는 신뢰한 업데이트 계획에 고정된 **인증된 plaintext manifest의 원시 SHA-256**과 현재 DB·blob inventory를 비교합니다. 사용자가 임의로 준 manifest/hash는 백업 인증을 대신하지 않습니다. 먼저 기존 verify/완전 복원으로 원본 백업을 인증하고 계획에 manifest hash를 고정해야 합니다. 외부 작성자와 migration을 정지한 상태에서 private 환경의 DATABASE_URL/BLOB_ROOT 및 기존 filesystem/S3 설정을 사용합니다. 비밀번호나 manifest 내용을 명령행·Git·로그에 넣지 마세요.

```sh
node scripts/service-backup.mjs check-source-inventory \
  --manifest-file /private/authenticated/manifest.json \
  --manifest-sha256 <trusted-plan-raw-manifest-sha256> \
  --quiesced
```

Manifest는 canonical 단일 링크0600 regular file, 최대16MiB입니다. DB에 연결하기 전에 hash와 형식을 검사합니다. 유지보수 exclusive82002 잠금을 기다리지 않고 획득하며, public 밖의 application schema와 다른 DB identity를 거부합니다. 별도의 읽기 전용 repeatable-read transaction 두 번으로 schema/migrations/모든 행/sequence state/모든 blob·orphan/reference를 수집하여 createdAt만 제외하고 인증된 inventory와 정확히 비교합니다. 두 번째는 첫 번째 transaction을 종료한 뒤 새 snapshot을 얻습니다. DB·blob·서명 설정을 쓰거나 dump/restore/update를 실행하지 않습니다. 매 transaction은 ROLLBACK하며 잠금 해제 실패는 성공 결과도 거부하고 pooled session을 폐기합니다. stdout에는 backup ID·hash·관찰 시각과 제한된 결과만 나오며 DB 행/작품 이름/키/자격 증명은 없습니다.

이 결과는 관찰 당시 원본 데이터 비교입니다. 외부 writer 격리나 미래 불변성, config volume/signing-key 보존, 전체 업데이트 preflight/application/rollback을 증명하지 않습니다. 기존 stopped-source Manager의 DB를 자동으로 시작하지 않습니다. Manager는 원본을 바꾸지 않는 별도 안전한 DB 관찰 adapter와 계획·source/candidate lock을 연결해야 합니다. 새 maintenance image는 재빌드·실행 검사 전까지 이전 image와 같은 기능으로 취급하지 않습니다. 기존 create/verify/restore 인자는 그대로 유지합니다.

`node scripts/test-source-inventory.mjs`는 별도 합성 PostgreSQL과 실제 암호화 백업으로 CLI 정상/변경/잠금/identity 경로를 검사합니다. 모든 시험 container를 정지하고 archive/blob/volume을 보존하며, 원본 사용자 데이터에는 연결하지 않습니다.

유지보수 이미지의 새 명령은 이미지 빌드 뒤 `BACKUP_CLI_IMAGE=sha256:<local-image-content-id> node scripts/test-source-inventory.mjs`로 실제 검사합니다. 고정된 local image ID만 받고 pull하지 않습니다. 시험 원본 PostgreSQL에 연결하며 private fixture root를 이미지에 읽기 전용으로 mount합니다. 각 관찰 helper는 ephemeral container로 종료 시 정리하고, source DB·volume·archive·blob은 정지·보존합니다. Docker Desktop의 host.docker.internal을 사용하는 Linux arm64 검사이며, private host 파일의 실제 소유 UID/GID를 명시적으로 사용합니다. 설정 관찰은 다른 UID 소유 파일을 거부하므로 root UID0으로 소유권 검사를 우회하지 않습니다. 기본 UID1000·Windows/Podman·cold engine·다른 네트워크·Manager의 정지된 DB 관찰 adapter를 대신하는 검사가 아닙니다. 결과는 이미지 ID와 실제 관찰 receipt를 private report에 기록합니다.

## Current configuration file observation

The trusted operator command `check-source-configuration --manifest-file <private authenticated manifest> --manifest-sha256 <trusted pinned raw hash> --quiesced` reads current files from the `BACKUP_CONFIGURATION_FILES` JSON name-to-absolute-path mapping. Supply the complete configuration name set from the authenticated backup, including the freeze signing key when present. The command needs neither a database connection nor the archive encryption key. A caller-chosen checksum does not authenticate a backup: obtain the exact manifest and pin from authenticated restoration and a trusted update plan.

Every manifest configuration record must have exactly one current reader; missing/extra mappings, empty scope, more than32 records or files over1MiB refuse. Private current files must be canonical regular single-link0600 files owned by the executing UID, with unchanged path identity, size and timestamps across each read. The command compares every file twice and erases the read buffers. Changed contents, alias/hardlink/public files and changed manifest bytes refuse; output contains only names, lengths, hashes, backup identity and observation time, never file values. It writes no source files and performs no dump, restore, DB or engine operation.

Success reports configurationFilesVerified:true, currentInventoryVerified:false, preflightVerified:false and updateExecuted:false. Mapping a name to a historical extracted backup does not prove it is the current source: the trusted Manager adapter must derive the owned current paths/volumes and maintain source/target/profile fences. The backup-generated manager-image-inventory.json needs independently regenerated current engine evidence; reading its historical copy is not current image proof. Repeated file equality is not an atomic cross-file snapshot or external writer isolation. Current DB/blob equality, resource/compatibility observations and actual migration/health/rollback remain separate. The existing source-inventory command continues to return configurationVerified:false. The synthetic Docker Desktop image driver exercises inventory against host read-only fixture blobs, and configuration against a separately owned Linux volume mounted read-only, both with the fixture owner UID/GID. Linux configuration files are seeded from synthetic host files into the new labeled volume; permission/link fault injection occurs inside that test volume, with original bytes and mode/link count restored. The volume remains retained. Default UID1000 and Manager/native/Windows/Podman integration remain pending.

Run `node scripts/test-source-inventory.mjs` after rebuilding Storage for the synthetic actual encrypted-backup regression: ten original DB/blob cases plus eight configuration cases. Test containers/volumes, archives and private synthetic evidence are retained; the temporary shared-link alias is removed after the refusal check while original bytes are preserved.

### Docker Desktop host metadata boundary

Actual Mac shared-bind probing found that changing a host file from0600 to0644 still appeared as0600 in the container, and a host hardlink count2 appeared as1 (GID also differed). Container configuration observation therefore cannot attest host file ownership/mode/link safety on this backend. Do not treat a successful container read of a Mac shared host file as that proof. The trusted Manager must directly validate current host metadata and identities, while source configuration-volume checks run against the owned native Linux volume. The image regression injects and rejects public permissions and shared links on a native Linux volume; it does not omit these tests or claim host-bind metadata qualification. Inode/time observations describe the filesystem actually seen by the reader. External writer isolation and atomic cross-file snapshot remain separate requirements.

The configuration CLI now refuses the observed Linux shared backend type0x65735546 before opening a current configuration file and after reading it, with SOURCE_CONFIGURATION_FILESYSTEM_UNVERIFIED. A Mac direct reader and owned native Linux volume remain supported by the measured regressions. Other filesystem backends and Windows are unqualified; the guard is not external-writer isolation.

Image regression seeds the authenticated immutable manifest into the same private native Linux fixture volume. Both inventory and configuration raw-manifest tamper cases modify that guest manifest and restore it from an unchanged read-only seed. Host shared-bind propagation is not used as the tamper oracle: actual testing observed a host append that the guest reader did not see immediately. The pinned raw manifest hash and refusal assertion remain unchanged. Test fixture data/volume and initial failure logs remain retained.
