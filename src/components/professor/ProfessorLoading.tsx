// 교수 화면 첫 로딩 — 학생 화면과 같은 셸(사이드바 · 헤더) 모양에 본문만 스켈레톤
import { LampLogo } from "@/components/student/ui";

export function ProfessorLoading() {
  return (
    <div className="lamp-app" role="status" aria-live="polite">
      <span className="lamp-sr-only">워크스페이스를 준비하고 있어요…</span>
      <aside className="lamp-sidebar" aria-hidden="true">
        <div className="lamp-brand">
          <LampLogo />
        </div>
        <div className="prof-loading-nav">
          {[88, 64, 72, 56, 80, 60, 70].map((w, i) => (
            <span
              key={i}
              className="lamp-skeleton"
              style={{ width: `${w}%`, height: 14 }}
            />
          ))}
        </div>
      </aside>
      <div className="lamp-workspace" aria-hidden="true">
        <header className="lamp-header">
          <span className="lamp-skeleton" style={{ width: 160, height: 14 }} />
        </header>
        <main className="lamp-main">
          <div className="lamp-heading">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                width: "100%",
              }}
            >
              <span
                className="lamp-skeleton"
                style={{ width: 280, maxWidth: "70%", height: 30 }}
              />
              <span
                className="lamp-skeleton"
                style={{ width: 360, maxWidth: "90%", height: 16 }}
              />
            </div>
          </div>
          <div className="prof-loading-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="lamp-skeleton-card">
                <span
                  className="lamp-skeleton"
                  style={{ width: 100, height: 14 }}
                />
                <span
                  className="lamp-skeleton"
                  style={{ width: 80, height: 30 }}
                />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
