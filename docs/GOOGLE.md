# 구글 문서 연동

팀원이 구글 문서 · 슬라이드 · 시트를 팀에 연결하면, 수정 구간마다 텍스트를 비교하고
**Drive Activity API로 그 구간에 실제로 편집한 팀원들에게 나눠** 기여로 기록한다.

- 연결 **이후**: 동기화 때마다 현재 본문을 export한 **자체 스냅샷**끼리 비교 (구글이 revision을 합쳐도 영향 없음)
- 연결 **이전**: 기존처럼 Drive **revision**으로 소급 (`snapshot_since` 경계로 중복 집계 방지)

## 로그인과 동시에 연결 (한양 구글 계정)
한양 구글 로그인 · 회원가입 때 `drive.file` · `drive.activity.readonly`를 함께 요청한다(`src/lib/google/scopes.ts`,
`access_type=offline`, `prompt=consent`). `/auth/callback`이 세션 교환 때만 받을 수 있는 provider 토큰을
`linkDriveFromLogin()`(`src/lib/google/loginLink.ts`)으로 아래 ①과 똑같이 암호화 저장한다. 로그인과 드라이브 연동이
같은 구글 OAuth 클라이언트라 refresh token을 그대로 쓸 수 있다.
- 결과: 로그인하자마자 문서 탭에서 바로 "문서 연결" → Picker. 별도 "구글 계정 연결" 단계 없음
- 실패해도(권한 거부 등) 로그인은 계속되고, 문서 탭의 "한양 구글 계정으로 연결"(아래 ①)로 다시 연결할 수 있다
- 비밀번호로 로그인하는 데모 계정은 구글 토큰이 없으므로 ①로 연결한다

## 동작 흐름

```
① 구글 계정 연결   /api/google/connect → 구글 동의(drive.file) → /api/google/callback
                    → refresh token AES-256-GCM 암호화 저장 (google_accounts)
                    → 이 사람의 과거 구글 수정 이력 소급 반영
② 문서 연결        Google Picker로 선택 → /api/google/link → external_docs
③ 동기화           /api/google/sync (화면 진입 시 + 열려 있는 동안 90초마다, 서버 1분 쿨다운 / "동기화" 버튼)
   a. 스냅샷       files.get(modifiedTime) 바뀌었으면 → 현재 본문 export → 직전 스냅샷과 diff
   b. 소급         revisions.list 중 snapshot_since 이전 것만 → revision별 export → diff
   c. 편집자       Drive Activity API (EDIT, consolidation 없음) → 구간별 편집자 · 편집 시간
   d. 배분         attribute(): 편집 시간 비율로 diff 나눔 → external_doc_credits → activity_events
   e. 재배분       Activity는 늦게 반영될 수 있어서 최근 5분 스냅샷 구간은 다음 동기화 때 다시 배분
```

### 여러 명이 한 구간을 편집했을 때 (`src/lib/google/attribute.ts`)
| 규칙 | 내용 |
|---|---|
| 구간 | (직전 스냅샷 시각, 이번 스냅샷 시각] — 밖으로 나간 편집 시간은 잘라냄 |
| 시각만 있는 이벤트 | 직전 30초 편집으로 간주 |
| 같은 사람 중복 | 겹치는 이벤트는 합집합 시간으로 |
| 비율 | 편집 시간 비율, 단 편집 기록이 있으면 최소 10% |
| 글자 수 | 최대 잔여법으로 정수 분배 (합계 보존) |
| confidence | `single` 1명 100% · `shared` 시간 비율 추정 · `fallback` Activity 없음 → lastModifyingUser |

예: 2분 구간에 +300/−40자, A 80초 · B 50초 → A +185/−25, B +115/−15

### 제안 모드 = 정확한 작성자 + 자동 수락 (권장)
팀원이 구글 문서에서 **제안 모드**로 쓰면 제안마다 작성자가 붙는다. 등잔 워커가 이를 기록하고 바로 수락해서,
문서는 수정 모드처럼 깔끔하게 유지되고 기여는 추정 없이 정확하게 남는다.

```
워커 (npm run worker, 2초마다 POST /api/google/suggestions/tick)
 ① Docs API documents.get(SUGGESTIONS_INLINE) → 제안 ID · 내용 (작성자는 안 줌)
 ② 내용이 2.5초간 그대로면 입력 끝으로 판단 (external_doc_suggestions.stable_since)
 ③ docx로 내보내 변경 내용 추적(w:ins/w:del)에서 작성자 이름 · 시각 → 내용으로 제안과 짝짓기
 ④ record_external_suggestion: 작성자 이름 = 팀원의 구글 표시 이름 → 기여 이벤트 (confidence: exact)
 ⑤ Docs API acceptSuggestion → 제안 후 약 3~5초 뒤 일반 글씨로
```
- 구글 **문서**만 (슬라이드 · 시트는 Docs API 미지원 → 기존 스냅샷 방식)
- 수락된 제안 글자는 스냅샷 diff 배분에서 빼고, 수락 API 호출로 찍힌 "연결한 사람"의 편집도 배분에서 제외 → 중복 집계 방지
- 작성자 매칭은 **이름** 기준 (docx에 이메일이 없음). 팀 안에 같은 이름이 둘이면 귀속하지 않고 보관
- docx에 아직 반영 안 된 제안은 수락하지 않고 다음 차례로 → 기록 없이 수락되는 일 없음
- 워커는 상시 실행이 필요해서 Vercel이 아닌 곳에서 돌린다 (발표 때는 노트북에서 `npm run worker`,
  배포 주소를 쓸 땐 `WORKER_BASE_URL=https://... npm run worker`). GCP 설정: `Google Docs API` 사용 설정

### 누가 · 언제 · 어디를
| | 저장 위치 | 정밀도 |
|---|---|---|
| 누가 | `external_doc_credits.author_id` | 구간에 편집자 1명이면 확정(`single`), 여러 명이면 시간 비율 추정 |
| 언제 | `external_doc_credits.edited_from ~ edited_to` | Drive Activity 기준 그 사람의 처음 ~ 마지막 편집 시각 (구간 밖은 잘림, fallback이면 없음) |
| 어디 | `external_doc_revisions.changes` | 바뀐 조각마다 줄 번호(문서는 문단, 시트는 행) + 추가/삭제 텍스트 + 앞뒤 30자 문맥, 구간당 최대 30곳 |

- 조각은 일반 텍스트 diff라서 **서식만 바꾼 수정은 안 잡힘**, 위치도 구글 문서 내부 위치가 아닌 텍스트 기준 줄 번호
- 여러 명이 섞인 구간은 조각별로 누가 썼는지까지는 나누지 않음 (구간 단위로만 배분)

| 구글 파일 | 기여 카테고리 | 비교 방식 |
|---|---|---|
| 문서 (Docs) | 문서 | text/plain 비교 |
| 슬라이드 (Slides) | 파일(결과물) | text/plain 비교 |
| 시트 (Sheets) | 파일(결과물) | text/csv 비교 (첫 시트) |

유효 글자(추가 + 삭제×0.5) 100자당 1점이며, 한 수정 구간에 배분하는 점수는 합계 최대 30점이다.

## 설계 포인트 (발표 · 명세서용)
- **파일 접근은 `drive.file`만** — 사용자가 Picker로 고른 파일에만 접근. 드라이브 전체 읽기 권한 없음
- **편집자 조회는 `drive.activity.readonly`** — 활동 기록만 읽음(내용 X). 제한(restricted) 범위로 분류될 수 있어
  실서비스 게시 시 구글 심사가 필요할 수 있음. 테스트 모드(테스트 사용자)에선 그대로 사용 가능
- Activity의 편집자(`people/{id}`)는 OAuth `id_token`의 `sub`로 팀원과 매칭 (`google_accounts.activity_person_id`)
- Activity를 못 읽으면(스코프 미허용 등) 동기화는 계속되고 lastModifyingUser 기준으로 기록
- 문서는 **연결한 팀원의 토큰**으로 동기화 (drive.file 특성). 그 팀원이 연결 해제하면 다른 팀원이 다시 연결하면 됨
- 수정자는 Drive의 `permissionId`로 팀원과 매칭. **구글 미연결 팀원의 수정은 보관만** 하고, 나중에 연결하면 소급 반영
- refresh token은 서버 키로 암호화, DB에서도 클라이언트가 읽을 수 없는 컬럼
- 같은 revision은 한 번만 기록 (멱등), 한 번에 문서당 25개씩 처리 후 이어서 처리

## 한계 (솔직하게 말하기)
- 같은 구간 안에서 **누가 정확히 어느 글자를 썼는지는 추정** (편집 시간 ≠ 글자 수). 구간을 짧게 해서 섞일 일을 줄임
  → 구글 문서 기여는 내부 문서보다 정밀도가 낮은 **보조 증거**. 정밀 측정은 등잔 내부 문서로
- 연결 이전 구간은 구글 revision 단위라 더 굵음 (구글이 짧은 시간의 편집을 합침)
- 화면이 닫혀 있으면 크론 주기만큼 구간이 길어짐
- 붙여넣기 감지 불가 (구글이 정보를 주지 않음)
- 오래된 revision은 내용 export가 안 될 수 있음 → "내용 비교 불가"로 수정 사실만 기록

## Google Cloud 설정 (한 번만)
1. [console.cloud.google.com](https://console.cloud.google.com) → 새 프로젝트
2. **API 및 서비스 → 라이브러리**: `Google Drive API`, `Google Picker API`, `Drive Activity API` 사용 설정
3. **OAuth 동의 화면**: 외부(External), 앱 이름 "등잔", 범위에 `.../auth/drive.file`, `.../auth/drive.activity.readonly` 추가
   - 테스트 모드면 **테스트 사용자**에 팀원 · 데모 계정 구글 이메일 추가 (최대 100명)
   - 테스트 모드 refresh token은 7일 후 만료 → 해커톤엔 문제 없음. 실서비스는 "프로덕션으로 게시"
     (`drive.file`은 민감하지 않은 범위라 심사 없이 게시 가능)
4. **사용자 인증 정보 → OAuth 클라이언트 ID** (웹 애플리케이션)
   - 승인된 JavaScript 원본: `http://localhost:3000`, `https://<배포도메인>`
   - 승인된 리디렉션 URI: `http://localhost:3000/api/google/callback`, `https://<배포도메인>/api/google/callback`
   - → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
5. **사용자 인증 정보 → API 키** → 제한: API = Picker API, 웹사이트 = 위 도메인 → `NEXT_PUBLIC_GOOGLE_API_KEY`
6. 프로젝트 설정의 **프로젝트 번호** → `NEXT_PUBLIC_GOOGLE_APP_ID`
7. `GOOGLE_TOKEN_ENC_KEY` 생성: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
8. 마이그레이션 적용: `npx supabase db push --remote` (또는 SQL Editor에서 `000004` → `000005` → `000006_hanyang_login`
   → `000007_google_attribution` → `000008_google_change_details` → `000009_google_attribution_integrity` 순서로 실행)
9. 000007 이전에 구글을 연결한 팀원은 **해제 후 다시 연결** (Activity 스코프 · 계정 ID 저장)

## API

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/google/connect?returnTo=` | 구글 동의 화면으로 이동 (state 쿠키로 CSRF 방지) |
| `GET /api/google/callback` | 토큰 교환 · 저장 · 소급 반영 → `returnTo?google=connected&credited=N` |
| `GET /api/google/token` | Picker용 본인 access token |
| `POST /api/google/link` `{teamId, fileId}` | 문서 연결 + 첫 동기화 |
| `POST /api/google/sync` `{teamId, force?}` | 팀 문서 동기화 (`remaining > 0`이면 다시 호출) |
| `GET /api/google/sync-all` | 크론 (Bearer `CRON_SECRET`) |
| `POST /api/google/disconnect` | 연결 해제 + 구글 토큰 취소 (반영된 기여는 유지) |

## 테이블
- `google_accounts` — 팀원 ↔ 구글 계정(permissionId), 암호화된 refresh token
- `external_docs` — 팀에 연결된 구글 파일, 마지막 동기화 revision · 텍스트
- `external_doc_revisions` — 구간 1건 (`source`: revision | snapshot) · 추가/삭제 글자 · 대표 작성자
- `external_doc_credits` — 구간을 편집자별로 나눈 결과 (몫 · confidence). 기여 이벤트의 근거

## 확인 상태
- DB 로직·권한: `npm run test:db` 의 "[구글 문서 연동]" · "[구글 기여 배분]" 시나리오 통과
- 배분 로직: `npm run test:unit` (attribute.ts 10개)
- 실제 구글 API 연동(OAuth · Picker · revision export)은 GCP 키 설정 후 직접 확인 필요
