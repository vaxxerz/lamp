# 분석 리포트 명세 (분석 엔진 · AI 담당용)

등잔 화면(`/lamp/analysis`, `/lamp/reports`)에 들어갈 **팀원별 기여 분석 리포트**의 입력 · 출력 형식이다.
화면 · 데이터 수집은 준비돼 있고, 담당자는 **입력 JSON → 출력 JSON** 을 만드는 엔진(규칙 + AI)만 구현하면 된다.

```
[등잔 서버] 데이터 수집 → (1) 입력 JSON ──▶ [분석 엔진: 규칙 지표 계산 → AI 문장 생성] ──▶ (2) 출력 JSON
                                                                                   │
                         ai_reports 저장 ◀────────────────────────────────────────────┘ → 화면 표시
```

- 호출 지점: `POST /api/ai-report` (`src/app/api/ai-report/route.ts`, 지금은 501 TODO)
- 화면 쪽 규칙 기반 집계: `src/lib/student/analytics.ts` (주 단위 · 팀원별 통계, 그대로 재사용 가능)

---

## 1. 요청

```http
POST /api/ai-report
{ "teamId": "uuid", "period": "1m" | "3m" | "all", "userId": "uuid (선택 — 없으면 팀 전체)" }
```

권한: 그 팀의 팀원 또는 담당 교수만 (`can_view_team`). 독립 팀플(교수 없음)은 팀원만.

---

## 2. 입력 JSON (서버가 만들어 엔진에 넘김)

```jsonc
{
  "version": 1,
  "team": {
    "id": "uuid",
    "name": "데모 A팀",
    "track": "class",                 // "class"(과목 · 교수 열람) | "independent"(학생끼리)
    "course": {                       // track = class 일 때만
      "name": "소프트웨어공학",
      "weights": { "document": 40, "task": 30, "meeting": 15, "file": 15 }  // 과목 가중치, 합 100
    }
  },
  "period": { "key": "3m", "from": "2026-08-03", "to": "2026-11-07" },     // 한국 시간
  "members": [{ "id": "uuid", "name": "학생1" }],

  // 점수의 근거가 되는 모든 활동 (activity_events). 리포트 근거는 반드시 이 id로 인용한다
  "events": [
    {
      "id": "uuid",
      "userId": "uuid",
      "category": "document",          // document | task | meeting | file
      "type": "external_doc_edit",     // 아래 표
      "points": 1.5,
      "createdAt": "2026-11-07T08:34:12Z",
      "attribution": "verified",       // verified | inferred (아래 3절)
      "meta": { "title": "등잔 제안모드 테스트", "chars_added": 120, "chars_removed": 4 }
    }
  ],

  // 내용 근거 (요약 문장에 "무엇을 했는지" 쓰기 위한 원문 조각, 각 300자 이내로 잘라서 전달)
  "details": {
    "googleSuggestions": [            // 구글 제안 = 작성자 확정
      { "eventId": "uuid", "userId": "uuid", "doc": "최종 보고서", "added": "…", "removed": "…", "at": "…" }
    ],
    "googleEdits": [                  // 구글 직접 수정 = 추정
      { "eventId": "uuid", "userId": "uuid", "doc": "…", "at": "…",
        "confidence": "single",       // single | shared(시간 비율로 나눔) | fallback(마지막 수정자)
        "fragments": [{ "line": 3, "added": "…", "removed": "…" }] }
    ],
    "tasks":    [{ "eventId": "uuid", "userId": "uuid", "title": "자료 조사", "status": "done", "verifiedBy": "uuid | null" }],
    "meetings": [{ "eventId": "uuid", "userId": "uuid", "title": "주간 회의", "status": "present", "comment": "…" }],
    "files":    [{ "eventId": "uuid", "userId": "uuid", "name": "발표.pptx", "version": 3,
                  "summary": { "slides_changed": [3, 5], "slides_added": [9] } }]
  },

  // 이미 계산된 지표 (엔진이 다시 계산하지 않아도 됨)
  "scores": [   // get_team_contributions — 과목 가중치 반영
    { "userId": "uuid", "document_score": 1.6, "task_score": 1.1, "meeting_score": 0, "file_score": 1.1,
      "share_pct": 100, "peer_share_pct": null, "mismatch": false, "kudos_received": 0 }
  ],
  "weekly": [   // analytics.ts memberStats — 한국 시간 월요일 시작 주
    { "userId": "uuid", "weeks": [{ "start": "2026-11-02", "count": 19, "points": 3.6 }] }
  ]
}
```

### 활동 종류 (`events[].type`)

| type | category | 언제 생기나 | 작성자 |
|---|---|---|---|
| `external_doc_edit` | document (슬라이드 · 시트는 file) | 구글 문서 제안 수락 · 구글 수정 구간 | 제안 = verified, 직접 수정 = inferred |
| `doc_edit` | document | 등잔 내부 문서 저장 (현재 화면에서는 숨김) | verified |
| `meeting_note` | meeting | 회의록 저장 | verified |
| `meeting_attend` | meeting | 다른 팀원이 출석 체크 (`meta.status` present / late) | verified |
| `task_create` | task | 할 일 생성 | verified |
| `task_complete` | task | 할 일 완료 (`meta.verified` = 다른 팀원 확인) | verified |
| `file_version` | file | 파일 새 버전 업로드 | verified |

---

## 3. 꼭 지킬 규칙

1. **근거 없는 주장 금지.** 요약 · 하이라이트 · 경고는 모두 `events[].id`를 근거로 인용한다. 입력에 없는 id를 만들지 않는다.
2. **확정(verified)과 추정(inferred)을 구분한다.** 개인 하이라이트의 근거는 verified 우선.
   inferred(구글 직접 수정)만으로 된 내용은 "추정"이라고 밝힌다.
3. **양 · 흔적만 말하고 품질 · 인성은 평가하지 않는다.** "기여가 적다"는 말할 수 있지만 "성의가 없다"는 안 된다.
4. **점수를 새로 만들지 않는다.** 비중 · 점수는 `scores`를 그대로 쓴다 (과목 가중치가 이미 반영됨).
5. 한국어, 학생에게 보여줘도 되는 존중하는 어조. 이름은 `members[].name` 그대로.
6. 독립 팀플(`track = independent`)은 교수가 보지 않는다 — "교수님께" 같은 표현을 쓰지 않는다.

---

## 4. 출력 JSON (엔진이 돌려줄 것)

```jsonc
{
  "version": 1,
  "teamId": "uuid",
  "period": { "key": "3m", "from": "2026-08-03", "to": "2026-11-07" },
  "generatedAt": "2026-11-07T10:00:00Z",
  "model": "rules-v1 + claude-sonnet-5-5",      // 규칙만이면 "rules-v1"

  "team": {
    "headline": "마감 직전 한 주에 활동의 80%가 몰렸어요",   // 40자 이내, 분석 탭 상단
    "summary": "2~3문장 팀 요약",
    "balance": { "topSharePct": 100, "activeMembers": 1, "totalMembers": 4 },
    "alerts": [                                   // 없으면 []
      {
        "type": "free_rider",                     // 아래 표
        "severity": "warning",                    // info | warning | critical
        "userIds": ["uuid"],
        "message": "학생4는 이 기간 확인된 활동이 없어요.",
        "evidenceIds": []                         // '없음'이 근거인 경고는 빈 배열 허용
      }
    ]
  },

  "members": [
    {
      "userId": "uuid",
      "summary": "구글 보고서 서론과 예산 표를 제안 모드로 작성했고, 할 일 2건을 완료했어요.",  // 3문장 이내
      "highlights": [                             // 최대 5개, 중요한 순
        { "label": "보고서 서론 작성 (+120자)", "evidenceIds": ["event-uuid"] }
      ],
      "pattern": "burst",                         // steady | burst | late | inactive (아래 표)
      "patternNote": "11/2 주에 활동 19건 중 19건",
      "share": { "activityPct": 100, "scorePct": 100 },
      "confidence": "high",                       // high(확정 근거 ≥ 70%) | medium | low
      "flags": []                                 // alerts와 같은 형식, 이 사람 관련만
    }
  ],

  "limitations": [                                // 화면 하단 회색 안내
    "구글 직접 수정은 편집 시간 비율로 나눈 추정치예요."
  ]
}
```

### 규칙 지표 정의 (AI 전에 엔진이 계산)

| 이름 | 정의 (초안 — 담당자가 조정) |
|---|---|
| `pattern = steady` | 활동이 있는 주가 기간 주 수의 50% 이상 |
| `pattern = burst` | 한 주에 그 사람 활동의 60% 이상 |
| `pattern = late` | 마지막 7일에 활동의 60% 이상 (마감일 정보가 생기면 마감 기준) |
| `pattern = inactive` | 활동 0건 |
| `alerts.free_rider` | 팀 내 점수 비중 < 100 / 팀원 수 × 0.3 |
| `alerts.last_minute` | 팀 전체 활동의 60% 이상이 마지막 7일 |
| `alerts.mismatch` | `scores[].mismatch = true` (활동 비중과 동료평가 비중 차이) |
| `alerts.silent_member` | 2주 이상 연속 활동 0 (기간 중간) |
| `confidence` | 그 사람 근거 중 verified 비율 ≥ 70% high, ≥ 40% medium, 그 외 low |

---

## 5. 저장 · 화면 매핑

현재 `ai_reports` 테이블은 **팀원 1명당 1행** (`summary`, `evidence [{event_id, label}]`, `model`).

| 출력 필드 | 저장 | 화면 |
|---|---|---|
| `members[].summary` | `ai_reports.summary` | AI 보고서 · 개인 카드 본문 |
| `members[].highlights` | `ai_reports.evidence` → `[{event_id, label}]` | 개인 카드 "주요 기여 활동" (클릭 시 기여 기록으로 이동) |
| `model` | `ai_reports.model` | 카드 하단 "생성 모델" |
| `team.*`, `alerts`, `pattern`, `confidence`, `limitations` | **저장 칸 없음** | 분석 탭 상단 헤드라인 · 경고, 팀원 카드 배지 |

→ 팀 단위 결과까지 저장하려면 `ai_reports`에 `scope ('team'|'member')`, `payload jsonb`, `period text` 컬럼 추가가 필요하다 (마이그레이션은 화면 쪽에서 같이 작업, 담당자는 출력 JSON만 맞추면 됨).

---

## 6. 완료 기준

- [ ] 입력 예시(2절)로 출력 예시(4절)와 같은 형식의 JSON이 나온다 (필드명 · 타입 · enum 값 그대로)
- [ ] 모든 `evidenceIds`가 입력 `events[].id` 안에 있다 (검사 함수 포함 권장)
- [ ] 활동 0건인 팀원도 `members`에 들어가고 `pattern = inactive`
- [ ] inferred만 근거인 하이라이트에는 label에 "(추정)"이 붙는다
- [ ] AI 없이 규칙만으로도(`model = "rules-v1"`) 같은 형식이 나온다 — AI 실패 시 대체용
- [ ] 한 팀(팀원 4명, 이벤트 500건) 기준 30초 이내 (서버리스 제한 60초)
