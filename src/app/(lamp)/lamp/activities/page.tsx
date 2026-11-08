import { Activities } from "@/components/student/Activities";

// ?doc= 로 들어오면 그 문서로 필터 (문서 분석 화면의 "수정 기록")
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { doc } = await searchParams;
  const initialDoc = typeof doc === "string" ? doc : null;
  return <Activities key={initialDoc ?? "all"} initialDoc={initialDoc} />;
}
