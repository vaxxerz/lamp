# Lamp 학생용 프론트엔드

## 실행

```bash
npm ci
npm run dev
```

학생용 워크스페이스의 시작 경로는 **`/lamp`** 입니다. Supabase 환경변수를 설정하고 로그인하면 열 수 있습니다. 비로그인 상태로 접근하면 로그인 화면에서 인증한 뒤 처음 열려던 주소로 돌아옵니다.

## 투트랙

| | 1트랙 독립 팀플 | 2트랙 과목 팀플 |
| --- | --- | --- |
| 시작 | 팀 이름만 입력 → 팀 초대코드 발급 | 교수에게 받은 과목 코드로 참여 → 팀 만들기 · 합류 |
| 합류 | 팀 초대코드 (`join_team_by_code`) | 과목 코드 (`join_course`) + `join_team` / `create_team` |
| 교수 | 없음 (열람 불가) | 교수가 팀 기여를 함께 봄 |
| DB | 팀마다 교수 없는 `courses.kind = 'independent'` (migration 011) | `courses.kind = 'class'` |
| 점수 가중치 | 기본값 (문서 40 · 할 일 30 · 회의 15 · 파일 15) | 과목 설정 |

- 로그인하면 `/lamp` 첫 화면은 **내 팀플 타일**(사이드바 없음). 타일을 누르면 그 팀으로 들어가고 팀 메뉴(대시보드 · 보드 · 문서 · 파일 · 기여 기록 · 보고서 · 회의)가 열림. 헤더 "내 팀플"로 타일 화면 복귀
- 팀이 없으면 첫 화면이 두 갈래 시작 화면, 팀이 있어도 타일의 "새 팀 만들기 · 참여"(`/lamp/teams/new`)로 추가
- 한 학생이 두 트랙의 팀에 동시에 속할 수 있음 (마지막으로 들어간 팀은 브라우저에 기억)
- 대시보드 · 사이드바에 "독립 팀플 · 교수 열람 없음" / "과목명 · 교수 열람" 표시, 독립 팀은 초대코드와 복사 버튼

## 실데이터 모드 (로그인 시)

등잔 계정으로 로그인했고 팀이 있으면 `/lamp`에서 해당 팀의 실데이터를 볼 수 있습니다.

| 화면 | 실데이터 출처 |
| --- | --- |
| 우상단 사용자 · 사이드바 | 로그인한 프로필, 내 팀 · 과목 · 팀원 / 메뉴에서 로그인 · 로그아웃 |
| 대시보드 · 기여 기록 | 구글 제안(작성자 확인됨) + 직접 수정 revision · 스냅샷(작성자 추정, 마지막 수정자 · 편집 시간 비율) |
| 연결된 문서 | 팀에 연결된 Google 문서 · 슬라이드 · 시트, 구글 계정 연결 · 드라이브에서 문서 연결 (문서별 기록은 "기여 기록에서 보기"로 이동) |
| 회의록 · 출석 | `meetings` · `meeting_attendance` · 회의록 문서 저장 API (본인 출석 변경은 DB 트리거도 차단) |
| AI 보고서 | 작성자가 확인된 기록만 근거로 만든 요약 (`src/lib/student/report.ts`, AI 문장 요약은 `/api/ai-report` 구현 후 연결) |

- 데이터 계층: `src/lib/student/live.ts` (읽기 · 쓰기), 상태: `StudentProvider` (`ws.mode`가 `live` | `mock`)
- 워커가 제안을 수락하거나 문서 · 회의 · 출석이 바뀌면 Supabase Realtime으로 화면이 자동 갱신됩니다.
- 팀원과 매칭되지 않은 구글 작성자는 이름만 "(미연결)"로 보여주고 기여로 세지 않습니다.

## 화면과 기능

| 경로 | 기능 |
| --- | --- |
| `/lamp/dashboard` | 팀 정보, 통계, 최근 활동, 화면 바로가기 |
| `/lamp/documents` | Google Docs/Slides URL 검증, 중복 방지, 문서 링크 추가, 실제 입력한 문서의 원본 열기 |
| `/lamp/activities` | 전체/내/팀원 활동 필터, 문서 필터, 정렬, 변경 전후 상세 보기 |
| `/lamp/reports` | 학생 선택, 개인/팀 보고서, Mock 재생성, 근거 기록으로 이동 |
| `/lamp/meetings` | 회의 생성, 회의록 저장, 다른 팀원 출석 상태 변경 |

모든 화면은 Mock 모드를 표시합니다. 기본 문서 2개는 실제 원본이 없는 예시이며 원본 링크를 제공하지 않습니다. 사용자가 추가한 링크도 Google 권한 확인이나 수정 기록 동기화를 수행하지 않습니다. 해당 링크의 실제 수정 시각은 미수집 상태로 표시합니다.

## 파일 구조와 연동 지점

- `src/app/(lamp)/lamp`: 페이지, 공통 레이아웃, 범위가 제한된 디자인 스타일, 로딩·오류 경계
- `src/components/student`: Sidebar, Header, ProjectCard, StatCard, DocumentCard, ActivityCard, ActivityTimeline, ContributionReportCard 및 페이지별 인터랙션
- `src/lib/student/types.ts`: User, Team, TeamMember, ConnectedDocument, ContributionActivity, ContributionReport, Meeting 인터페이스
- `src/lib/student/mock-data.ts`: 예시 학생·팀·문서·기여 기록·회의
- `src/lib/student/api.ts`: 비동기 Mock 데이터 접근 계층. 실제 API 연동 시 이 계층과 현재 학생 공급 방식을 교체합니다.
- `src/components/student/StudentProvider.tsx`: 페이지 간 공유 상태, 브라우저 저장 데이터 복원과 오류 복구

문서·회의록·출석은 `localStorage`의 `lamp-student-demo-v1`에 저장되어 같은 브라우저에서 새로고침 후 유지됩니다. 브라우저·사용자 간 공유되지 않습니다. 저장소가 손상되면 재시도 또는 데모 초기화를 제공합니다. 보고서는 확인된 예시 활동에 대해 매번 생성하는 Mock 요약이며 외부 AI를 호출하지 않습니다.

## 작성자와 출석 원칙

- `verified`: 작성자가 확인된 활동만 개인 보고서 근거와 확인된 활동 수에 포함합니다.
- `inferred`: 작성자 추정으로 표시하며 검증된 것으로 취급하지 않습니다.
- `unknown`: 작성자 미확인으로 표시하고 특정 학생에게 배정하지 않습니다.
- 대시보드의 비중은 확인된 활동 수 기준의 참고값입니다. 기여의 질·공정성을 평가하는 점수가 아닙니다.
- 출석 선택에서 로그인한 예시 학생은 비활성화됩니다. Mock API도 본인 상태 변경을 거부합니다. 실제 권한 제한은 백엔드에서도 검증해야 합니다.
- 표시 시간과 회의 생성 입력 시간은 한국 시간(Asia/Seoul)입니다.

## 검증

```bash
npm run typecheck
npm run lint
npm run build
# 별도 터미널에서 개발 서버를 실행한 상태
npm run test:student
```

`LAMP_TEST_URL`로 검사할 서버 주소를 지정할 수 있습니다(기본 포트 3000). 테스트는 학생 페이지에 대한 비로그인 요청이 원래 주소를 포함해 로그인으로 이동하는지, 학생 데모 로그인 후 그 주소에 접속할 수 있는지 확인합니다. 테스트 서버에 `DEMO_PASSWORD`를 설정하고 `npm run seed:demo`로 데모 계정을 준비하세요.
