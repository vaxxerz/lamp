// 예시 화면(Mock)용 미리보기 데이터 — 실제와 같은 계산(buildInsight)을 가짜 구간 기록으로 돌린다
import { buildInsight, type DocInsight, type RevisionRow, type SuggestionRow } from "./insight";

const P1 = "1. 연구 배경";
const P1B =
  "본 연구에서는 기상 데이터를 활용하여 산불 발생 요인을 분석한다. 최근 기후 변화로 인한 건조 일수 증가와 기온 상승이 산불 발생에 미치는 영향을 살펴본다.";
const P1C = " 지역별 강수량과 풍속 데이터를 결합하여 위험 요인을 파악하고, 산불 예방을 위한 데이터 기반의 대응 방향을 제안한다.";
const P2 = "2. 분석 방법";
const P2B_OLD = "기존의 회귀 분석을 사용한다. 결측값을 처리한다.";
const P2B = "랜덤 포레스트 모델을 사용하여 변수별 중요도를 비교한다. 결측값은 지역별 중앙값으로 보간하고, 이상치는 IQR 기준으로 제거한다.";
const P3 = "3. 분석 결과";
const P3B = "모델별 정확도와 재현율을 비교하는 표를 작성했다. 랜덤 포레스트가 정확도 0.87로 가장 높았고, 풍속과 습도가 주요 변수로 나타났다.";
const P3C = " 특히 봄철 건조 일수가 10일 이상인 지역에서 산불 위험이 두 배 이상 높았다.";
const P4 = "참고 문헌";
const P4B = "기상청 (2025). 기상자료개방포털. https://data.kma.go.kr\n산림청 (2025). 산불통계연보.";

const join = (...parts: string[]) => parts.join("\n");

const people = {
  jimin: { id: "jimin", name: "김지민" },
  seoyeon: { id: "seoyeon", name: "박서연" },
  doyun: { id: "doyun", name: "이도윤" },
};
type Who = keyof typeof people;

const day = (d: number, hm: string) => `2026-11-${String(d).padStart(2, "0")}T${hm}:00+09:00`;

function rev(
  id: string,
  at: string,
  from: string,
  text: string,
  credits: [Who, number, number, number][], // [사람, 비율, 추가, 삭제]
): RevisionRow {
  return {
    id,
    modified_at: at,
    period_start: from,
    source: "snapshot",
    text_after: text,
    chars_added: credits.reduce((n, c) => n + c[2], 0),
    chars_removed: credits.reduce((n, c) => n + c[3], 0),
    google_display_name: null,
    author_id: credits[0] ? people[credits[0][0]].id : null,
    author: credits[0] ? { name: people[credits[0][0]].name } : null,
    credits: credits.map(([who, share, added, removed]) => ({
      author_id: people[who].id,
      display_name: null,
      share,
      confidence: credits.length > 1 ? "shared" : "single",
      chars_added: added,
      chars_removed: removed,
      author: { name: people[who].name },
    })),
  };
}

export function demoInsight(docId: string, title: string, now = Date.parse(day(8, "12:00"))): DocInsight {
  const base = join(P1, P2, P2B_OLD);
  const t1 = join(P1, P1B, P2, P2B_OLD);
  const t2 = join(P1, P1B + P1C, P2, P2B_OLD, P3);
  const t3 = join(P1, P1B + P1C, P2, P2B, P3);
  const t4 = join(P1, P1B + P1C, P2, P2B, P3, P3B, P4, "기상청 자료");
  const t5 = join(P1, P1B + P1C, P2, P2B, P3, P3B + P3C, P4, P4B);
  const revisions = [
    rev("d1", day(2, "21:10"), day(2, "20:40"), t1, [["jimin", 1, 70, 0]]),
    rev("d2", day(3, "15:30"), day(3, "15:00"), t2, [["jimin", 1, 52, 0]]),
    rev("d3", day(4, "22:05"), day(4, "21:30"), t3, [
      ["jimin", 0.6, 34, 14],
      ["doyun", 0.4, 22, 9],
    ]),
    rev("d4", day(6, "16:40"), day(6, "16:00"), t4, [["seoyeon", 1, 72, 0]]),
    rev("d5", day(7, "14:20"), day(7, "13:50"), t5, [
      ["doyun", 0.7, 40, 5],
      ["seoyeon", 0.3, 18, 0],
    ]),
  ];
  const suggestions: SuggestionRow[] = [
    {
      id: "demo-s1",
      added_text: P3C.trim(),
      chars_added: 34,
      chars_removed: 0,
      accepted_at: day(7, "14:05"),
      author_id: people.seoyeon.id,
      author_name: null,
      author: { name: people.seoyeon.name },
    },
  ];
  return buildInsight(
    {
      id: docId,
      title,
      mime_type: "application/vnd.google-apps.document",
      web_url: null,
      last_synced_at: day(8, "11:58"),
      snapshot_text: t5,
      last_text: t5,
      blame_base_text: base,
      blame_base_at: day(1, "10:00"),
    },
    revisions,
    suggestions,
    now,
  );
}
