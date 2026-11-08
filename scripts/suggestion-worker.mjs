// 구글 문서 제안 자동 기록 · 수락 워커 — 발표 · 데모 중 켜 두기
// 실행: npm run worker               (로컬 dev 서버 http://localhost:3000)
//       WORKER_BASE_URL=https://배포주소 npm run worker
// 1초마다 /api/google/suggestions/tick 호출 (이전 호출이 끝난 뒤 다음 호출)
const base = process.env.WORKER_BASE_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;
const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 1000);
if (!secret) {
  console.error("CRON_SECRET이 없어요 (.env.local)");
  process.exit(1);
}

console.log(`suggestion worker → ${base} (${intervalMs}ms)`);
for (;;) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/google/suggestions/tick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    const json = await res.json();
    for (const r of json.results ?? []) {
      if (r.error) console.warn(new Date().toLocaleTimeString("ko-KR"), r.externalDocId, r.error);
      else if (r.accepted) console.log(new Date().toLocaleTimeString("ko-KR"), r.externalDocId, `수락 ${r.accepted} · 대기 ${r.waiting}`);
    }
    if (!res.ok) console.warn("tick", res.status, json.error);
  } catch (e) {
    console.warn("tick failed", e.message);
  }
  await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (Date.now() - started))));
}
