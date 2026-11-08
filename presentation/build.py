"""deck-source.html(편집용 원본)에서 배포용 단일 HTML 두 개를 만든다.

  summit-pitch-v2.html         발표용: 단계별 공개, 설명 문구 숨김(C 키로 토글)
  summit-pitch-v2-submit.html  제출용: 설명 문구 표시, 각 장을 완성된 상태로

assets/ 의 이미지를 base64로 파일 안에 넣으므로, 결과 HTML은 파일 하나만 보내도 사진이 보인다.
내용은 deck-source.html 에서만 고치고 `python3 build.py` 를 다시 실행한다.
"""
import base64, re
from pathlib import Path

here = Path(__file__).parent
src = (here / "deck-source.html").read_text(encoding="utf-8")
mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp"}

def inline(m):
    attr, path = m.group(1), m.group(2)
    f = here / path
    data = base64.b64encode(f.read_bytes()).decode()
    return f'{attr}="data:{mime[f.suffix.lower()]};base64,{data}"'

# 이미지 preload 는 인라인 후 의미가 없으니 제거
src = re.sub(r'\s*<link rel="preload" as="image" href="assets/[^"]+"\s*/?>', "", src)
src = re.sub(r'\b(src|href)="(assets/[^"]+)"', inline, src)
left = re.findall(r'(?:src|href)="assets/', src)
assert not left, "인라인되지 않은 assets 참조가 남았습니다"
assert '<body class="hide-rd">' in src

(here / "summit-pitch-v2.html").write_text(src, encoding="utf-8")
sub = src.replace('<body class="hide-rd">', '<body class="submit">', 1)
sub = sub.replace("<title>Lamp. Summit Keynote</title>", "<title>Lamp. Summit Keynote (제출용)</title>", 1)
(here / "summit-pitch-v2-submit.html").write_text(sub, encoding="utf-8")
for n in ("summit-pitch-v2.html", "summit-pitch-v2-submit.html"):
    print(n, f"{(here / n).stat().st_size / 1e6:.1f} MB")
