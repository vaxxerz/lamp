# Lamp 교수용 프론트엔드

> **실데이터 연결됨**: 로그인한 교수는 `/professor`에서 같은 화면을 Supabase 실데이터로 본다
> (`src/lib/professor/live.ts`, RLS가 담당 과목만 열람 허용). `/professor-demo`는 로그인 없는 공개 Mock 그대로.
> 실데이터에서 되는 쓰기: 과목 열기(`courses` insert), 과목 안 팀 만들기(`create_team` RPC).
> 수업 과목의 팀은 과목 코드로 참여하므로 팀 초대코드 · 재발급은 실데이터에서 보이지 않는다.
> AI 보고서는 아직 실제 AI가 아니라 작성자가 확인된 기록을 모은 요약이다.

개발 브랜치: `front2`. 기존 학생용 `/lamp`와 인증된 `/professor`는 유지합니다.

## 실행과 화면

Node.js 24 (검증: 24.22.1), npm 11, 시스템 Chromium을 사용합니다.

```bash
npm ci
npm run dev
```

교수용 **공개 Mock 데모** 시작 경로: `/professor-demo`.

| 경로                         | 기능                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `/professor-demo`            | **모든 수업 홈** — 담당 수업 여러 개를 한눈에: 수업 타일(팀·학생·문서·작성자 상태·최근 7일 변경), 모든 수업의 팀과 살펴볼 점, 최근 변경 |
| `/professor-demo/dashboard?course=c1` | **수업 하나의 대시보드** — 사이드바 "내 수업"에서 고른다. 고른 수업은 다른 메뉴 링크(`?course=`)에도 이어진다 |
| `/professor-demo/dashboard`  | 전체 대시보드 — 모든 담당 수업을 합친 통계와 팀별 현황, 과목·팀 필터                         |
| `/professor-demo/dashboard?course=c1` 팀별 지표 | **수업 화면은 팀 단위 숫자만** — 팀원 · 문서 · 변경 기록(확인/추정/미확인) · 7일 변경 · 변경한 팀원 수 · 회의 · 최근 변경 · 살펴볼 점. 팀원별 분석 · 기록 · 보고서 · 회의록은 사이드바 **팀 탭**으로 팀 화면에 들어가서 본다 |
| `/professor-demo/teams/[teamId]/analysis` | 팀 하나의 팀원 분석 — 주별 변경 그래프, 팀원 비교 표, 팀원별 주별 그래프(같은 축). 팀원 이름 · "기록 보기"는 `activities?student=` 로 그 팀원 기록을 연다 |
| `/professor-demo/activities` · `reports` · `meetings` · `analysis` | 예전 수업 단위 주소 — `?team=`이 있으면 그 팀 화면, 없으면 수업 대시보드로 옮겨 준다 |
| `/professor-demo/courses`    | 교수 팀 생성, 과목/팀 초대코드 구분·복사, 재발급 확인창, 팀원·팀장                        |
| `/professor-demo/teams/[teamId]/dashboard` | 팀 카드에서 진입하는 학생 화면 구성의 팀 상세 · 사이드바 '수업 › 대시보드'나 경로(브레드크럼)로 수업 대시보드 복귀 |

날짜 입력과 표시는 Asia/Seoul 기준입니다. 팀 생성과 초대코드는 `lamp-professor-teams-v1` localStorage에만 저장되며 실제 초대·참여는 발생하지 않습니다. 손상된 저장 데이터는 오류 화면에서 초기화할 수 있습니다. Mock 보고서 재생성은 메모리에만 유지됩니다. 예시 문서는 실제 원본이 없어 링크를 표시하지 않으며 실서비스 `sourceUrl`이 있으면 원본 링크를 표시합니다.

## 팀 카드에서 학생 화면 구성으로 조회

대시보드와 과목·팀 관리의 **팀 상세 · 수정 기록 보기**는 `/professor-demo/teams/[teamId]/dashboard`로 이동합니다. 학생용 CSS·통계·문서·활동 카드·팀 정보 대화상자를 재사용하며, 선택한 팀의 학생 화면 구성을 읽기 전용으로 제공합니다. 사이드바에 팀 메뉴와 수업 메뉴가 함께 보이고, 헤더 경로(모든 수업 › 수업 › 팀 › 메뉴)로 돌아갈 수 있습니다.

팀 안의 메뉴는 대시보드, 연결된 문서, 기여 기록, AI 보고서, 회의록·출석이며 모든 경로에서 같은 `teamId`를 유지합니다. 학생 역할로 로그인하거나 다른 학생의 저장 데이터를 사용하지 않습니다. 문서 연결·출석 수정·회의록 저장 등 쓰기 동작은 제공하지 않으며, 팀 밖의 데이터와 접근 불가능한 팀은 표시하지 않습니다. 기존 교수 메뉴의 전체 수정 기록은 그대로 유지합니다.

전용 구현은 `src/components/professor/ProfessorTeamWorkspace.tsx`입니다. 기존 학생 `ActivityCard`는 선택적으로 팀 문서·사용자 목록을 받을 수 있게 확장했으며, 기본 학생 동작은 유지합니다.

## 코드와 백엔드 교체 지점

- `src/lib/professor/member-analysis.ts`: 팀원 분석 집계(순수 함수, `member-analysis.test.mjs`). 작성자 미확인 기록은 개인에게 넣지 않고, 공동 편집(`shares`)은 편집 비율로 변경량을 나눈다. 화면 조각은 `src/components/professor/MemberAnalysis.tsx`.

- **셸은 학생 `/lamp`와 같다**: `ProfessorShell.tsx`(사이드바 · 수업 선택 · 메뉴 그룹 · 헤더 경로 · 빠른 검색 ⌘K · 알림 · 프로필/로그아웃)와 `ProfessorProvider.tsx`(데이터 한 번 로드 · 로딩/오류 게이트)는 `layout.tsx`에 한 번만 그려진다. 메뉴를 옮겨도 셸과 데이터가 유지되어 로딩 화면이 뜨지 않는다. 첫 화면 '모든 수업'은 학생의 '모든 프로젝트'처럼 사이드바 없이 전체 폭.
- `src/components/professor/ProfessorView.tsx`: 주소 → 본문 선택. 주소는 `page.tsx`가 props로 넘긴다 (Cache Components가 숨겨 둔 이전 화면이 훅으로 현재 주소를 읽어 내용이 두 벌 되는 것을 막음).
- `src/components/professor/ProfessorWorkspace.tsx`: 수업 단위 화면 본문(홈 · 대시보드 · 팀원 분석 · 과목·팀 관리 · 기록 · 보고서 · 회의).
- `src/lib/professor/types.ts`: 학생의 활동·문서·출석 타입을 재사용하면서 실제 `courseId`, 팀 생성 주체, 팀 코드, 출석 확인 정보를 추가합니다.
- `src/lib/professor/api.ts`: 로딩, Mock 저장·초기화. 실제 인증된 서버 API로 교체할 경계입니다.
- `src/lib/professor/scope.ts`: 담당 과목·팀 범위, 문서-팀 일치 필터. **클라이언트 필터는 보안 경계가 아닙니다.**
- `src/lib/professor/mock-data.ts`, `mock-reports.ts`: 독립된 예시 데이터와 보고서. 추정/미확인 활동은 개인 기여 근거로 사용하지 않습니다.
- `src/proxy.ts`: 공개 Mock 경로 두 조건만 추가. 기존 학생·교수 인증과 실제 API 흐름은 유지합니다.

실제 연결 시 필요한 작업:

1. 기존 서버의 `requireRole("professor")`와 검증된 Supabase 세션을 사용합니다. Google 제공자·검증된 한양대 이메일·DB에서 결정한 교수 역할을 확인하고, 이메일 도메인만으로 교수 권한을 부여하지 않습니다. 현재 `front2`의 인증 지침은 `docs/AUTH.md`입니다. `docs/HANYANG_AUTH.md`는 `front`에서 확인한 과거 문서이며 현재 인증 흐름과 차이가 있어 덮어쓰지 않았습니다. `docs/STUDENT_TEAMS.md`는 최신 `front`의 `3ca513b`에서 읽었습니다. 이 커밋은 `front2`에 아직 포함되지 않은 학생 팀 온보딩 변경입니다. 학생 브랜치를 임의로 병합하지 않고 해당 문서의 팀 생성 주체·초대코드·courseId·서버 권한 계약을 따랐습니다. 두 Mock의 저장소는 분리되어 있으므로 교수 Mock에서 생성한 팀이 학생 Mock에 동기화되지는 않습니다.
2. 서버 API와 DB RLS 모두 `courses.professor_id = authenticatedUser.id` 및 `teams.course_id`를 검사합니다. 허용되지 않는 ID는 403/404로 응답하며 전체 데이터를 먼저 브라우저로 전송하지 않습니다. 새 UI의 실데이터 버전은 보호된 `/professor` 아래에 연결합니다. 공개 `/professor-demo`에는 실데이터를 연결하지 않습니다.
3. 교수 생성 팀, 팀장, 팀 초대코드 설정·재발급 API는 별도 구현이 필요합니다. 기존 과목 코드와 팀 코드는 분리하고 충돌 방지·재발급 원자성·담당 과목 검증을 서버에서 보장합니다. 현재 임의 코드 설정은 지원하지 않으며 Mock 재발급만 제공합니다.
4. Google 수집 담당자가 팀별 문서/활동, 원본 URL, 작성자 확인 상태를 반환하도록 어댑터를 연결합니다. `unknown`의 작성자는 임의 배정하지 않습니다. 원본 기록 수정·삭제 UI는 없습니다.
5. 실제 AI API를 연결하기 전까지 Mock 표시를 유지합니다. 보고서 근거와 학생/팀 범위를 서버에서도 검증합니다. 최종 성적이나 공정성 자동 판정은 제공하지 않습니다.
6. 회의록·출석은 서버 조회로 연결합니다. 확인자·시각이 없으면 미제공으로 표시하며, 교수 수정 권한을 추가하지 않습니다. Supabase 및 OAuth 비밀값은 서버 설정에만 저장합니다.

실제 Supabase 자격 증명이 없는 환경에서 로그인, 원격 RLS, Google 동기화, AI API, Vercel 배포는 검증하지 않았습니다.

## 검증

```bash
npm run typecheck
npm run lint
npm run build
npm run test:unit
npm run test:db
node --test src/lib/professor/*.test.mjs
# npm run dev가 별도로 실행 중인 상태
node scripts/professor-smoke.mjs
node scripts/professor-team-smoke.mjs
npm run test:student
```

교수 브라우저 검사는 팀 범위·생성·저장 유지·코드 재발급/취소, 기록 필터·정렬·날짜·더 보기, 확인된 활동 보고서·근거 이동, 조회 전용 출석, 잘못된 팀 접근 거부, 모바일 5개 화면·메뉴, 손상된 저장소 복구를 검사합니다. Chromium 경로는 `CHROMIUM_EXECUTABLE`, 서버는 `LAMP_TEST_URL`, 스크린샷 위치는 `LAMP_TEST_ARTIFACTS`로 지정할 수 있습니다. 기본 결과물은 `/tmp/lamp-professor-artifacts`입니다.

팀 조회 전용 브라우저 검사는 카드 진입·Lamp 복귀, 5개 팀 메뉴, 팀 정보, 팀별 데이터 분리와 새로고침, 읽기 전용 출석·저장소 무변경, 보고서 근거 이동(첫 페이지 밖 기록 포함), 빈 팀·권한 없음, 모바일 메뉴·가로 넘침을 검증합니다. 기본 스크린샷은 `/tmp/lamp-professor-team-artifacts`에 저장합니다.
