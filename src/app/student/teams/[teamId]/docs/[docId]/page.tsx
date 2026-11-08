import { Todo } from "@/components/Todo";

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <Todo owner="B">
        Tiptap 에디터 (회의록도 같은 컴포넌트 재사용)
        <ul className="mt-2 list-disc pl-5">
          <li>입력 멈추고 3초 후 POST /api/documents/[docId]/save {"{ baseVersion, content, contentText, pastedChars }"}</li>
          <li>409(version_conflict) → &quot;다른 팀원이 수정했어요&quot; 안내 후 새로고침</li>
          <li>handlePaste로 붙여넣은 글자 수 누적 → pastedChars</li>
          <li>Realtime Presence로 &quot;OO님 편집 중&quot; 표시 + 편집 잠금</li>
          <li>버전 기록 패널: document_revisions (작성자 · +/− 글자)</li>
        </ul>
      </Todo>
    </div>
  );
}
