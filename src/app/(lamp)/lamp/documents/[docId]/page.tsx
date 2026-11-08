import { DocumentDetail } from "@/components/student/DocumentDetail";

export default async function Page({ params }: PageProps<"/lamp/documents/[docId]">) {
  const { docId } = await params;
  return <DocumentDetail docId={docId} />;
}
