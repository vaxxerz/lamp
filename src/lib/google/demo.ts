// 발표 시연용 시드 문서 (scripts/seed-demo.mjs) — 실제 Drive 파일이 없으므로 동기화 · 권한 공유 대상에서 뺀다.
// Drive 파일 id는 [A-Za-z0-9_-]만 쓰므로 ':'가 들어간 id는 실제 문서와 겹치지 않는다.
export const DEMO_EXTERNAL_ID_PREFIX = "demo:";
export const DEMO_EXTERNAL_ID_PATTERN = `${DEMO_EXTERNAL_ID_PREFIX}%`;
