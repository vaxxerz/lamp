import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "등잔(Lamp) 소개" };

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-6 px-6 py-12 break-keep">
      <h1 className="text-4xl font-bold">등잔(Lamp)</h1>
      <p className="text-lg leading-relaxed">
        한양대학교 학생과 교수가 팀 프로젝트의 협업과 기여 기록을 살펴보는 서비스입니다.
      </p>
      <section aria-labelledby="google-documents" className="space-y-3">
        <h2 id="google-documents" className="text-xl font-semibold">Google 문서 연결</h2>
        <p className="leading-relaxed">
          Google 파일 선택기에서 팀이 함께 쓸 문서, 슬라이드 또는 스프레드시트를 선택할 수 있습니다.
          등잔은 선택한 파일의 변경 사항을 동기화하고, 그 파일의 편집 활동을 이용해 편집자별 기여 기록을 보여줍니다.
          여러 사람이 같은 구간을 편집한 경우에는 기여량을 추정해 표시합니다.
        </p>
        <p className="leading-relaxed">
          한양대학교 Google 계정의 이름과 이메일은 로그인과 계정 식별에 사용합니다.
          파일 내용과 편집 활동을 어떻게 처리하는지는 개인정보처리방침에서 확인할 수 있습니다.
        </p>
      </section>
      <nav className="flex flex-wrap items-center gap-3" aria-label="등잔 시작 및 개인정보">
        <Link href="/login" className="btn-primary inline-flex min-h-11 items-center">한양대 계정으로 시작하기</Link>
        <Link href="/privacy" className="inline-flex min-h-11 items-center px-3 underline underline-offset-4">개인정보처리방침</Link>
      </nav>
    </main>
  );
}
