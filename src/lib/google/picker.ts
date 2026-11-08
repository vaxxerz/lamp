"use client";
// 클라이언트: Google Picker로 문서 하나 고르기 → Drive file id
// drive.file 스코프는 Picker로 고른 파일에만 앱 접근 권한을 주므로 반드시 Picker 사용.

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? ""; // GCP 프로젝트 번호

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const done = () => window.gapi.load("picker", { callback: () => resolve(), onerror: reject });
    if (window.gapi) return done();
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = done;
    script.onerror = () => {
      loading = null;
      reject(new Error("google_api_load_failed"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function pickGoogleFile(accessToken: string): Promise<string | null> {
  if (!API_KEY || !APP_ID) throw new Error("NEXT_PUBLIC_GOOGLE_API_KEY / NEXT_PUBLIC_GOOGLE_APP_ID is not set");
  await loadPicker();
  const p = google.picker;
  return new Promise((resolve) => {
    const view = new p.DocsView(p.ViewId.DOCS)
      .setMimeTypes(
        [
          "application/vnd.google-apps.document",
          "application/vnd.google-apps.presentation",
          "application/vnd.google-apps.spreadsheet",
        ].join(","),
      )
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    new p.PickerBuilder()
      .setAppId(APP_ID)
      .setDeveloperKey(API_KEY)
      .setOAuthToken(accessToken)
      .setLocale("ko")
      .setTitle("팀에 연결할 구글 문서 선택")
      .addView(view)
      .addView(new p.DocsView(p.ViewId.DOCS).setEnableDrives(true).setIncludeFolders(true))
      .setCallback((data: google.picker.ResponseObject) => {
        if (data[p.Response.ACTION] === p.Action.PICKED) resolve(data[p.Response.DOCUMENTS]?.[0]?.[p.Document.ID] ?? null);
        else if (data[p.Response.ACTION] === p.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
