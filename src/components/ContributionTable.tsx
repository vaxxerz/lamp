import type { Contribution } from "@/lib/types";

/** get_team_contributions 결과 표. TODO(C): Recharts 도넛/막대 차트로 시각화 */
export function ContributionTable({ rows, showPeer = true }: { rows: Contribution[]; showPeer?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-zinc-500">
        <tr>
          <th className="py-2">이름</th>
          <th>기여 비율</th>
          <th>문서</th>
          <th>태스크</th>
          <th>회의</th>
          <th>파일</th>
          {showPeer && <th>상호평가 비율</th>}
          {showPeer && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.user_id} className="border-t border-zinc-100 dark:border-zinc-900">
            <td className="py-2 font-medium">{r.name}</td>
            <td className="font-semibold">{r.share_pct}%</td>
            <td>{r.document_score}</td>
            <td>{r.task_score}</td>
            <td>{r.meeting_score}</td>
            <td>{r.file_score}</td>
            {showPeer && <td>{r.peer_share_pct != null ? `${r.peer_share_pct}%` : "-"}</td>}
            {showPeer && <td>{r.mismatch && <span className="text-red-600">⚠️ 불일치</span>}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
