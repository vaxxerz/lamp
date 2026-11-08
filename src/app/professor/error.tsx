"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <section className="lamp-empty" role="alert">
      <h2>화면을 불러오지 못했어요</h2>
      <p>잠시 후 다시 시도해 주세요.</p>
      <button className="lamp-button" onClick={reset}>
        다시 시도
      </button>
    </section>
  );
}
