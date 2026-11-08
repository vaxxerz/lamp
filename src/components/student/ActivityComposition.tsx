"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const CATEGORIES = [
  { key: "document", label: "문서" }, { key: "task", label: "작업" },
  { key: "meeting", label: "회의" }, { key: "file", label: "파일" },
] as const;
type Counts = Readonly<Record<(typeof CATEGORIES)[number]["key"], number>>;
function position(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { top: Math.min(rect.bottom + 8, window.innerHeight - 80), left: Math.max(12, Math.min(rect.right - 240, window.innerWidth - 252)) };
}

export function ActivityComposition({ counts }: { readonly counts: Counts }) {
  const id = useId();
  const trigger = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<{ readonly top: number; readonly left: number } | null>(null);
  const open = anchor !== null;
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const element = trigger.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setAnchor(rect.bottom < 0 || rect.top > window.innerHeight ? null : position(element));
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [open]);
  const total = CATEGORIES.reduce((sum, c) => sum + counts[c.key], 0);
  const text = total === 0 ? "기록된 활동이 없어요" : CATEGORIES.filter((c) => counts[c.key] > 0)
    .map((c) => `${c.label} ${Math.round(counts[c.key] / total * 100)}%`).join(", ");
  function show(element: HTMLElement) {
    trigger.current = element;
    setAnchor(position(element));
  }
  return <>
    <button className="lamp-composition-trigger" aria-label={`활동 구성: ${text}`} aria-describedby={anchor ? id : undefined}
      onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setAnchor(null)}
      onFocus={(e) => show(e.currentTarget)} onBlur={() => setAnchor(null)}
      onClick={(e) => show(e.currentTarget)} onKeyDown={(e) => { if (e.key === "Escape") setAnchor(null); }}>
      <span className="lamp-composition" aria-hidden="true">{total === 0 ? <span className="empty" /> : CATEGORIES.filter((c) => counts[c.key]).map((c) => <span key={c.key} className={c.key} style={{ flex: counts[c.key] }} />)}</span>
    </button>
    {anchor && createPortal(<span id={id} role="tooltip" className="lamp-composition-tooltip" style={anchor}>{text}</span>, document.querySelector(".lamp-app") ?? document.body)}
  </>;
}
