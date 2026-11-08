-- =============================================================
-- 등잔(Lamp) — 13. 구글 문서 미리보기 형광펜 (누가 어느 부분을 썼는지)
--
--  구간(스냅샷 · revision)마다 "그 구간이 끝난 시점의 본문"을 남겨 두면,
--  읽을 때 시간 순서대로 diff를 다시 돌려 현재 본문의 글자 하나하나가
--  어느 구간(→ 배분된 편집자) 또는 어느 제안에서 왔는지 계산할 수 있다 (src/lib/google/blame.ts).
--  배분이 나중에 바뀌어도(재배분 · 소급 연결) 읽을 때 계산하므로 따로 갱신할 것이 없다.
--
--  blame_base_*: 구간 기록이 없는 시점의 본문 (첫 스냅샷 기준선, 또는 이 마이그레이션 시점의 본문).
--                여기서 처음 보이는 글자는 "기록 이전"으로 표시한다.
-- =============================================================

alter table public.external_doc_revisions
  add column text_after text;  -- 구간이 끝난 시점의 본문 (null = 저장 안 됨: 예전 기록 · export 실패)

alter table public.external_docs
  add column blame_base_text text,
  add column blame_base_at   timestamptz;

-- 이미 연결된 문서: 지금 본문을 기준선으로 (이후 수정부터 형광펜이 쌓임)
update public.external_docs
   set blame_base_text = coalesce(snapshot_text, last_text),
       blame_base_at   = coalesce(snapshot_at, last_synced_at, now())
 where blame_base_text is null
   and coalesce(snapshot_text, last_text) <> '';
