import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "등잔(Lamp) 개인정보처리방침" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12 leading-relaxed break-keep">
      <header className="space-y-2">
        <Link href="/about" className="inline-flex min-h-11 items-center underline underline-offset-4">등잔 소개</Link>
        <h1 className="text-3xl font-bold">등잔(Lamp) 개인정보처리방침</h1>
        <p>시행일 <time dateTime="2026-11-08">2026년 11월 8일</time></p>
      </header>
      <section className="space-y-2" aria-labelledby="data-use">
        <h2 id="data-use" className="text-xl font-semibold">수집하는 정보와 이용 목적</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Google 계정의 이름, 이메일 및 계정 식별자는 한양대 계정 로그인, 회원 식별과 편집자 연결에 사용합니다. 가입 시 입력한 학번과 학과 등은 프로필과 수업 참여에 사용합니다.</li>
          <li>Google Picker로 선택해 연결한 파일의 식별자, 제목, 링크, 유형, 본문 및 버전 정보는 문서를 연결하고 변경 내용을 동기화하는 데 사용합니다.</li>
          <li>연결한 파일의 편집자 이름과 식별자, 활동 시각, 변경 내용, 제안 이력을 조회해 변경 구간과 편집자별 기여량을 계산합니다. 연결된 Google 문서에서 등잔이 작성자를 확인해 기록한 편집 제안은 자동으로 수락될 수 있습니다.</li>
        </ul>
      </section>
      <section className="space-y-2" aria-labelledby="data-storage">
        <h2 id="data-storage" className="text-xl font-semibold">저장 및 열람</h2>
        <p>등잔은 Vercel에서 Google API 요청을 처리합니다. 파일 메타데이터, 버전별 본문과 변경 내역, 편집자별 집계는 Supabase에 저장합니다. 이후 동기화에 필요한 Google 갱신 토큰은 암호화해 저장합니다.</p>
        <p>문서와 기여 기록은 접근 권한이 있는 팀원과 해당 수업 담당 교수에게 표시됩니다. Google API 데이터와 그 파생 정보의 사용 및 공유는 이 방침에 명시한 기능을 제공하는 목적으로 제한됩니다.</p>
      </section>
      <section className="space-y-2" aria-labelledby="data-deletion">
        <h2 id="data-deletion" className="text-xl font-semibold">연결 해제, 보관 및 삭제</h2>
        <p>문서 화면의 ‘연결 해제’에서 계정 연결을 해제하면 등잔은 저장한 갱신 토큰을 삭제하고 Google에 권한 취소를 요청합니다. 이미 동기화된 문서 사본과 기여 기록은 팀 프로젝트 기록으로 보관됩니다.</p>
        <p>운영팀은 프로젝트 종료를 통보받거나 이용자가 자신의 데이터 삭제를 요청하면 요청자의 신원과 대상 범위를 확인합니다. 확인 후 30일 이내에 등잔이 보관 중인 해당 문서 사본, 활동 기록 및 파생 집계를 삭제하거나 처리 결과와 사유를 안내합니다. Google Drive의 원본은 이용자가 Google에서 관리합니다.</p>
      </section>
      <section className="space-y-2" aria-labelledby="limited-use">
        <h2 id="limited-use" className="text-xl font-semibold">Google API 데이터 사용</h2>
        <p>
          등잔은 Google API에서 받은 데이터의 사용과 전송에 대해 제한적 사용 요건을 포함한{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" className="underline underline-offset-4">Google API 서비스 사용자 데이터 정책</a>
          을 준수합니다.
        </p>
      </section>
      <section className="space-y-2" aria-labelledby="privacy-contact">
        <h2 id="privacy-contact" className="text-xl font-semibold">운영자와 문의</h2>
        <p>운영자 lamp 팀. 열람, 정정, 삭제 및 프로젝트 종료 통보는 <a href="mailto:ian5003@naver.com" className="underline underline-offset-4">ian5003@naver.com</a>으로 보내주세요.</p>
      </section>
    </main>
  );
}
