// 구글 문서 제안(suggestion) 처리용 순수 함수 — DB·네트워크 의존 없음
//
//  Docs API: 제안 ID · 내용 · 위치는 주지만 작성자는 안 줌
//  docx 내보내기: 제안이 변경 내용 추적(w:ins / w:del)으로 들어가고 작성자 · 시각이 붙음
//  → 두 결과를 내용(텍스트)으로 짝지어 제안 ID마다 작성자를 찾는다

/** Docs API 제안 1건 (같은 ID의 추가 · 삭제 조각을 합친 것) */
export type DocSuggestion = {
  id: string;
  added: string;
  removed: string;
  startIndex: number;
};

/** docx 변경 추적 1건 */
export type TrackedChange = {
  kind: "ins" | "del";
  author: string;
  date: string | null;
  text: string;
};

export type MatchedSuggestion = DocSuggestion & { author: string; date: string | null };

type TextRun = { content?: string; suggestedInsertionIds?: string[]; suggestedDeletionIds?: string[] };
type StructuralElement = {
  paragraph?: { elements?: { startIndex?: number; textRun?: TextRun }[] };
  table?: { tableRows?: { tableCells?: { content?: StructuralElement[] }[] }[] };
};

/** documents.get(suggestionsViewMode=SUGGESTIONS_INLINE) 응답 → 제안 목록 (표 안 포함, 문서 순서) */
export function extractSuggestions(doc: { body?: { content?: StructuralElement[] } }): DocSuggestion[] {
  const byId = new Map<string, DocSuggestion>();
  const visit = (content: StructuralElement[] | undefined) => {
    for (const el of content ?? []) {
      for (const pe of el.paragraph?.elements ?? []) {
        const run = pe.textRun;
        if (!run?.content) continue;
        const add = (id: string, key: "added" | "removed") => {
          const s = byId.get(id) ?? { id, added: "", removed: "", startIndex: pe.startIndex ?? 0 };
          s[key] += run.content!;
          s.startIndex = Math.min(s.startIndex, pe.startIndex ?? s.startIndex);
          byId.set(id, s);
        };
        run.suggestedInsertionIds?.forEach((id) => add(id, "added"));
        run.suggestedDeletionIds?.forEach((id) => add(id, "removed"));
      }
      el.table?.tableRows?.forEach((row) => row.tableCells?.forEach((cell) => visit(cell.content)));
    }
  };
  visit(doc.body?.content);
  return [...byId.values()].sort((a, b) => a.startIndex - b.startIndex);
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`w:${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
};

/** word/document.xml → 변경 추적 목록 (문서 순서) */
export function parseTrackedChanges(documentXml: string): TrackedChange[] {
  const out: TrackedChange[] = [];
  for (const m of documentXml.matchAll(/<w:(ins|del)\b([^>]*?)(\/>|>([\s\S]*?)<\/w:\1>)/g)) {
    const body = m[4] ?? "";
    const text = [...body.matchAll(/<w:(?:t|delText)\b[^>]*>([^<]*)<\/w:(?:t|delText)>/g)]
      .map((t) => decodeXml(t[1]))
      .join("");
    out.push({ kind: m[1] as "ins" | "del", author: attr(m[2], "author") ?? "", date: attr(m[2], "date"), text });
  }
  return out;
}

/** 비교용: 공백 · 줄바꿈 무시 */
export const normalize = (s: string) => s.replace(/\s+/g, "");

/**
 * 제안마다 작성자 찾기. 추가 → ins, 삭제 → del 조각과 내용으로 짝짓고, 같은 내용이 여러 번이면 문서 순서대로.
 * docx에 아직 반영 안 된 제안은 결과에서 빠짐 (다음 차례에 다시 시도).
 * 내용이 공백뿐인 제안(줄바꿈만 추가 등)은 기여 0이라 작성자 없이 통과.
 */
export function matchAuthors(suggestions: DocSuggestion[], changes: TrackedChange[]): MatchedSuggestion[] {
  const used = new Set<number>();
  const take = (kind: "ins" | "del", text: string) => {
    const want = normalize(text);
    if (!want) return null;
    // 조각이 여러 run으로 나뉘어 있을 수 있어서, 같은 작성자의 연속 조각을 이어 붙여 비교
    for (let i = 0; i < changes.length; i++) {
      if (used.has(i) || changes[i].kind !== kind) continue;
      let joined = "";
      const idx: number[] = [];
      for (let j = i; j < changes.length && joined.length < want.length; j++) {
        if (used.has(j) || changes[j].kind !== kind || changes[j].author !== changes[i].author) break;
        joined += normalize(changes[j].text);
        idx.push(j);
      }
      if (joined === want) {
        idx.forEach((k) => used.add(k));
        return changes[i];
      }
    }
    return null;
  };

  const out: MatchedSuggestion[] = [];
  for (const s of suggestions) {
    const ins = s.added ? take("ins", s.added) : null;
    const del = s.removed ? take("del", s.removed) : null;
    const hasText = normalize(s.added) || normalize(s.removed);
    if (!hasText) {
      out.push({ ...s, author: "", date: null });
      continue;
    }
    if ((normalize(s.added) && !ins) || (normalize(s.removed) && !del)) continue;
    const hit = ins ?? del!;
    out.push({ ...s, author: hit.author, date: hit.date });
  }
  return out;
}

/** 입력 중인지 판단용: 내용이 바뀌면 값이 달라짐 */
export function suggestionHash(s: DocSuggestion) {
  // FNV-1a 32bit — 같은지만 보면 되므로 충분
  let h = 0x811c9dc5;
  for (const ch of `${s.added}\u0000${s.removed}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.added.length}:${s.removed.length}:${h.toString(16)}`;
}
