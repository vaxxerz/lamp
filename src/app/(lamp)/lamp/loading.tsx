/** 페이지 전환 중 스켈레톤 — 실제 대시보드 벤토와 같은 틀 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <span className="lamp-sr-only">페이지를 준비하고 있어요…</span>
      <div className="lamp-heading" aria-hidden="true">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
          <span className="lamp-skeleton" style={{ width: 280, maxWidth: "70%", height: 30 }} />
          <span className="lamp-skeleton" style={{ width: 360, maxWidth: "90%", height: 16 }} />
        </div>
      </div>
      <div className="lamp-bento" aria-hidden="true">
        <div className="lamp-skeleton-card lamp-project-card" style={{ alignItems: "stretch" }}>
          <span className="lamp-skeleton" style={{ width: 120, height: 14 }} />
          <span className="lamp-skeleton" style={{ width: "60%", height: 24 }} />
          <span className="lamp-skeleton" style={{ width: "40%", height: 14 }} />
        </div>
        <div className="lamp-skeleton-card lamp-stat lamp-stat-feature">
          <span className="lamp-skeleton" style={{ width: 100, height: 14 }} />
          <span className="lamp-skeleton" style={{ width: 120, height: 52 }} />
          <span className="lamp-skeleton" style={{ width: "100%", height: 8 }} />
        </div>
        <div className="lamp-skeleton-card lamp-stat">
          <span className="lamp-skeleton" style={{ width: 100, height: 14 }} />
          <span className="lamp-skeleton" style={{ width: 80, height: 30 }} />
        </div>
        <div className="lamp-skeleton-card lamp-stat">
          <span className="lamp-skeleton" style={{ width: 100, height: 14 }} />
          <span className="lamp-skeleton" style={{ width: 80, height: 30 }} />
        </div>
      </div>
    </div>
  );
}
