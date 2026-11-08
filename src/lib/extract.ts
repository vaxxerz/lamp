// 서버 전용: 업로드 파일에서 텍스트 추출 (pptx · docx · hwpx). 그 외 포맷은 null → 버전만 기록.
import JSZip from "jszip";
import mammoth from "mammoth";

/** pptx는 슬라이드 사이를 이 문자로 구분해 extracted_text에 저장 → 다음 버전과 슬라이드 단위 비교 */
export const SLIDE_SEPARATOR = "\f";

export type Extracted = { text: string; slides?: string[] } | null;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function textRuns(xml: string, tag: string) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return Array.from(xml.matchAll(re), (m) => decode(m[1])).join(" ");
}

async function zipTexts(buf: Buffer, pathRe: RegExp, tag: string) {
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.keys(zip.files)
    .map((name) => ({ name, n: Number(name.match(pathRe)?.[1]) }))
    .filter((e) => !Number.isNaN(e.n))
    .sort((a, b) => a.n - b.n);
  return Promise.all(entries.map(async (e) => textRuns(await zip.file(e.name)!.async("string"), tag)));
}

export async function extractText(buf: Buffer, extension: string | null): Promise<Extracted> {
  try {
    switch (extension?.toLowerCase()) {
      case "pptx": {
        const slides = await zipTexts(buf, /^ppt\/slides\/slide(\d+)\.xml$/, "a:t");
        return { text: slides.join(SLIDE_SEPARATOR), slides };
      }
      case "docx":
        return { text: (await mammoth.extractRawText({ buffer: buf })).value };
      case "hwpx":
        return { text: (await zipTexts(buf, /^Contents\/section(\d+)\.xml$/, "hp:t")).join("\n") };
      default:
        return null; // hwp(구형) · pdf · 이미지 등 — TODO(A): pdf 텍스트 추출 필요 시 추가
    }
  } catch {
    return null;
  }
}
