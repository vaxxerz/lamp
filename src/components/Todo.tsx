// 아직 구현 안 된 영역 표시 (담당자 · 할 일). 기능 구현하면서 지우기.
export function Todo({ owner, children }: { owner: "A" | "B" | "C"; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <span className="mr-2 rounded bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-amber-950">
        TODO · {owner}
      </span>
      {children}
    </div>
  );
}

export function Loading() {
  return <p className="p-6 text-sm text-zinc-500">불러오는 중…</p>;
}
