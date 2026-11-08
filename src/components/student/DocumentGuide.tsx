"use client";
import { useState, type ReactNode } from "react";
import { NotebookPen } from "lucide-react";
import { Dialog } from "./Dialog";

export function DocumentReminder() {
  return <div className="lamp-document-reminder"><NotebookPen size={16} /><div><strong>작성하는 동안 제안 모드를 유지해 주세요</strong><p>Google 문서 오른쪽 위에서 ‘제안’을 선택하세요. ‘수정’ 모드로 바꾸면 작성자별 기여를 정확히 기록하기 어려워요.</p></div></div>;
}

export function DocumentStartLink({ url, title, children, requireSuggestion = true, className }: {
  readonly url: string; readonly title: string; readonly children: ReactNode; readonly requireSuggestion?: boolean; readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <a className={className} href={url} target="_blank" rel="noreferrer" aria-label={`${title} Google에서 열기`} onClick={(e) => { if (requireSuggestion) { e.preventDefault(); setOpen(true); } }}>{children}</a>
    {open && <Dialog close={() => setOpen(false)} labelId="document-guide-title">
      <div className="lamp-document-guide">
        <h2 id="document-guide-title">문서를 시작하기 전에</h2>
        <ol>
          <li><strong>오른쪽 위 ‘제안’을 선택하세요</strong><span>Google 문서의 연필 모양 메뉴에서 작성 모드를 확인하세요.</span></li>
          <li><strong>제안 모드를 바꾸지 마세요</strong><span>‘수정’ 모드로 전환하면 누가 작성했는지 정확히 기록하기 어려워요.</span></li>
          <li><strong>그대로 작성하면 돼요</strong><span>Lamp가 작성자를 기록하고 제안을 자동으로 수락해요.</span></li>
        </ol>
        <div className="lamp-actions"><button className="lamp-button secondary" onClick={() => setOpen(false)}>돌아가기</button><a className="lamp-button" href={url} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>확인하고 문서 열기</a></div>
      </div>
    </Dialog>}
  </>;
}
