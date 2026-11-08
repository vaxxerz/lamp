# 로그인 (한양대 구글 계정 전용)

| 사용자 | 로그인 방법 | 역할 결정 |
|---|---|---|
| 학생 | 구글 로그인 (`@hanyang.ac.kr`만) | 기본값 학생 |
| 교수 | 구글 로그인 (`@hanyang.ac.kr`만) | `professor_emails` 허용 목록에 있는 이메일만 교수 |
| 심사위원 | 로그인 화면 하단 **"교수로 체험" / "학생으로 체험"** 원클릭 버튼 (또는 데모 이메일/비밀번호) | `demo_accounts`에 지정 |

## 첫 화면 · 회원가입
- 로그인 안 된 채 `/`에 오면 `/login`으로 보낸다 (proxy). 로그인 상태면 교수 → `/professor`, 학생 → `/lamp`
- `/login`: 한양대 구글 로그인 + 심사위원용 데모 버튼
- `/signup`: **학생 / 교수**를 고르고 한양대 구글 계정으로 가입. 학생은 학번(10자리) · 학과, 교수는 소속 학과(모두 선택)
  - 고른 값은 10분짜리 `lamp_signup` 쿠키 → `/auth/callback?signup=1`이 `complete_signup()` RPC로 저장
  - **교수를 골라도 권한을 바로 주지 않는다.** `professor_emails`에 있는 메일이면 이미 교수, 아니면
    `professor_requests`에 신청(pending)만 남고 학생 권한으로 시작 → `/signup/pending`에서 상태 확인
  - 관리자가 `professor_emails`에 메일을 넣으면 자동 승격 + 신청은 approved
  - 사용자가 보낼 수 있는 값은 학번 · 학과 · 신청 의사뿐 (`profiles.role`은 여전히 수정 불가)
- 회원가입 없이 로그인 탭에서 바로 구글 로그인해도 계정은 만들어진다 (학생, 기존 동작)

### 교수 신청 확인 · 승인
```sql
select email, department, created_at from public.professor_requests where status = 'pending';
insert into public.professor_emails (email, note) values ('신청한메일@hanyang.ac.kr', '확인 완료');  -- 승인
update public.professor_requests set status = 'rejected', decided_at = now() where email = '...';  -- 거절
```

## 어떻게 막는가 (발표 · 명세서용)
- 구글 로그인 화면의 `hd=hanyang.ac.kr`은 **계정 선택 힌트일 뿐**이라 우회 가능 →
  **DB 트리거(`handle_new_user`)가 가입 순간에** 다음을 강제하고, 어기면 가입 자체가 실패한다
  - 제공자가 `google`이 아니면 거부 (이메일/비밀번호로 `@hanyang.ac.kr` 주소를 사칭하는 것 차단)
  - 이메일이 `@hanyang.ac.kr`로 끝나지 않으면 거부
  - 예외는 관리자만 쓸 수 있는 `demo_accounts`에 등록된 이메일뿐
- 교수 권한은 사용자가 보내는 값(메타데이터)을 믿지 않고 `professor_emails` 허용 목록으로만 부여.
  이미 학생으로 가입한 사람도 목록에 추가하면 즉시 교수로 승격
- `/auth/callback`에서 한 번 더 도메인을 확인 (이중 방어)
- 검증: `npm run test:db`의 "[한양대 로그인]" 9개 + "[회원가입: 학생 / 교수 선택]" 14개 시나리오

## Supabase 설정
설정은 `supabase/config.toml`로 관리하고 `npx supabase config push`로 반영한다 (config.toml은 원격과 맞춰둔 상태).

| 항목 | 상태 |
|---|---|
| Site URL `http://localhost:3000`, Redirect URL `http://localhost:3000/**` | ✅ 적용됨 (배포 후 Vercel 도메인 추가) |
| 이메일 인증(Confirm email) | ✅ 꺼져 있음 |
| 이메일 가입 | 켜둠 — 끄면 구글 첫 로그인(가입)까지 막힘. 대신 DB 트리거가 데모 외 이메일 가입을 거부 |
| Google 제공자 | ✅ 켜짐 — GCP 프로젝트 `lamp-hackathon`, OAuth 클라이언트 `lamp-web` |
| Google OAuth 앱 게시 상태 | ⬜ **테스트 중** — 테스트 사용자로 등록한 구글 계정만 로그인 가능 (Google Cloud → Google 인증 플랫폼 → 대상 → 테스트 사용자) |

### Google 제공자 켜기
1. Google Cloud → API 및 서비스 → **OAuth 동의 화면**: 외부, 범위 `openid` `email` `profile`
   (민감하지 않은 범위라 "프로덕션으로 게시"해도 심사 없음. 테스트 모드면 테스트 사용자만 로그인 가능)
2. **사용자 인증 정보 → OAuth 클라이언트 ID (웹)** — 구글 문서 연동과 같은 클라이언트 재사용 가능
   - 승인된 리디렉션 URI: `https://znvcopkujjyovmtewurg.supabase.co/auth/v1/callback`
3. `supabase/.env` (git 무시됨)에:
   ```
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
   ```
4. `supabase/config.toml`의 `[auth.external.google]` → `enabled = true` 후 `npx supabase config push`
5. 배포 후 `site_url` / `additional_redirect_urls`에 Vercel 도메인 추가 → 다시 push

## 교수 등록
Supabase SQL Editor에서:
```sql
insert into public.professor_emails (email, note) values ('professor@hanyang.ac.kr', '소프트웨어공학 담당');
```

## 데모 계정
```bash
npm run seed:demo   # .env.local 의 DEMO_PASSWORD 사용, 여러 번 실행해도 안전
```
- `professor@demo.lamp` (교수), `student1~4@demo.lamp` (학생, 4번은 무임승차 시나리오용)
- "소프트웨어공학 (데모)" 과목과 "데모 A팀"까지 생성
- 제출물의 "테스트 계정" 항목에 이 이메일과 비밀번호를 적는다
- **원클릭 버튼**(`POST /api/demo-login`)은 서버가 `DEMO_PASSWORD`로 대신 로그인 → 비밀번호가 브라우저로 나가지 않음.
  교수 → `professor@demo.lamp`, 학생 → `student1@demo.lamp`. 배포 환경변수에 `DEMO_PASSWORD`가 없으면 비활성
- 데모 팀에 발표용 활동 데이터는 아직 없음 → TODO(C): 시드 확장
