-- =============================================================
-- 등잔(Lamp) — 4. 구글 문서 연동용 enum 값
--   ALTER TYPE ... ADD VALUE는 같은 트랜잭션에서 새 값을 쓸 수 없어서 별도 파일로 분리
-- =============================================================
alter type public.activity_type add value if not exists 'external_doc_edit';  -- 구글 문서/슬라이드/시트 수정
