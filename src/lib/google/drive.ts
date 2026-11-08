// 서버 전용: Drive REST v3 최소 클라이언트 (googleapis 패키지 대신 fetch)
const API = "https://www.googleapis.com/drive/v3";

export const GOOGLE_MIME = {
  document: "application/vnd.google-apps.document",
  presentation: "application/vnd.google-apps.presentation",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
} as const;
export const SUPPORTED_MIME: string[] = Object.values(GOOGLE_MIME);

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`google_api_${status}: ${body.slice(0, 200)}`);
  }
}

async function gfetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new GoogleApiError(res.status, await res.text());
  return res;
}

export type DriveUser = { displayName?: string; emailAddress?: string; permissionId?: string };
export type DriveFile = { id: string; name: string; mimeType: string; webViewLink?: string };
export type DriveRevision = {
  id: string;
  modifiedTime: string;
  lastModifyingUser?: DriveUser;
  exportLinks?: Record<string, string>;
};

export async function getAbout(token: string): Promise<DriveUser> {
  const res = await gfetch(token, `${API}/about?fields=user(displayName,emailAddress,permissionId)`);
  return (await res.json()).user;
}

export async function getFile(token: string, fileId: string): Promise<DriveFile> {
  const res = await gfetch(
    token,
    `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`,
  );
  return res.json();
}

/** 전체 revision 목록 (오래된 순) */
export async function listRevisions(token: string, fileId: string): Promise<DriveRevision[]> {
  const out: DriveRevision[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      pageSize: "200",
      fields:
        "nextPageToken,revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress,permissionId),exportLinks)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gfetch(token, `${API}/files/${encodeURIComponent(fileId)}/revisions?${params}`);
    const json = (await res.json()) as { revisions?: DriveRevision[]; nextPageToken?: string };
    out.push(...(json.revisions ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
}

function exportFormat(mimeType: string) {
  return mimeType === GOOGLE_MIME.spreadsheet ? "text/csv" : "text/plain";
}

/**
 * revision 시점의 텍스트. revision exportLinks를 우선 쓰고, 없으면 최신 revision에 한해
 * 현재 파일을 export. 과거 본문이 없으면 null, 요청 실패는 호출자에게 전달.
 */
export async function exportRevisionText(
  token: string,
  fileId: string,
  mimeType: string,
  revision: DriveRevision,
  isLatest: boolean,
): Promise<string | null> {
  const format = exportFormat(mimeType);
  const link = revision.exportLinks?.[format];
  if (link) {
    try {
      return normalize(await (await gfetch(token, link)).text());
    } catch (error) {
      // 이 링크의 만료는 파일 자체의 접근 실패와 구분한다.
      if (!(error instanceof GoogleApiError) || (error.status !== 404 && error.status !== 410)) throw error;
    }
  }
  if (!isLatest) return null;
  return exportCurrentText(token, fileId, mimeType);
}

/** 현재 본문 (자체 스냅샷용) */
export async function exportCurrentText(token: string, fileId: string, mimeType: string): Promise<string> {
  const format = exportFormat(mimeType);
  const url = `${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(format)}`;
  return normalize(await (await gfetch(token, url)).text());
}

export type DriveFileState = { modifiedTime: string; lastModifyingUser?: DriveUser };

/** 마지막 수정 시각 · 수정자 (바뀌었을 때만 export하기 위한 가벼운 조회) */
export async function getFileState(token: string, fileId: string): Promise<DriveFileState> {
  const res = await gfetch(
    token,
    `${API}/files/${encodeURIComponent(fileId)}?fields=modifiedTime,lastModifyingUser(displayName,emailAddress,permissionId)&supportsAllDrives=true`,
  );
  return res.json();
}

// ---------- Drive Activity API v2 ----------
const ACTIVITY_API = "https://driveactivity.googleapis.com/v2/activity:query";
const ACTIVITY_MAX_PAGES = 20;

/** 한 사람의 편집 1건. 시각만 있는 이벤트는 start === end (ms) */
export type EditSpan = { personId: string; start: number; end: number };

type ActivityResponse = {
  activities?: {
    actors?: { user?: { knownUser?: { personName?: string } } }[];
    timestamp?: string;
    timeRange?: { startTime?: string; endTime?: string };
  }[];
  nextPageToken?: string;
};

/**
 * sinceMs 이후 이 파일의 편집(EDIT) 이벤트. 사람별로 쪼개 받기 위해 consolidation 없이 조회.
 * 스코프 미허용 · API 미사용 설정이면 GoogleApiError(403)
 */
export async function queryEditActivity(token: string, fileId: string, sinceMs: number | null): Promise<EditSpan[]> {
  const filter = ["detail.action_detail_case:EDIT", sinceMs != null ? `time >= ${Math.floor(sinceMs)}` : null]
    .filter(Boolean)
    .join(" AND ");
  const spans: EditSpan[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < ACTIVITY_MAX_PAGES; page++) {
    const res = await gfetch(token, ACTIVITY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemName: `items/${fileId}`,
        filter,
        consolidationStrategy: { none: {} },
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      }),
    });
    const json = (await res.json()) as ActivityResponse;
    for (const a of json.activities ?? []) {
      const start = Date.parse(a.timeRange?.startTime ?? a.timestamp ?? "");
      const end = Date.parse(a.timeRange?.endTime ?? a.timestamp ?? "");
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      for (const actor of a.actors ?? []) {
        const name = actor.user?.knownUser?.personName; // "people/123..."
        if (name?.startsWith("people/")) spans.push({ personId: name.slice(7), start, end });
      }
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return spans;
}

const normalize = (s: string) => s.replace(/^﻿/, "").replace(/\r\n/g, "\n");

// ---------- Google Docs API (제안 자동 수락) ----------
const DOCS_API = "https://docs.googleapis.com/v1/documents";

/** 제안이 포함된 문서 본문 (SUGGESTIONS_INLINE). 작성자는 응답에 없음 */
export async function getDocumentWithSuggestions(token: string, documentId: string) {
  const fields =
    "body.content(paragraph.elements(startIndex,textRun(content,suggestedInsertionIds,suggestedDeletionIds))," +
    "table.tableRows.tableCells.content(paragraph.elements(startIndex,textRun(content,suggestedInsertionIds,suggestedDeletionIds))))";
  const params = new URLSearchParams({ suggestionsViewMode: "SUGGESTIONS_INLINE", fields });
  const res = await gfetch(token, `${DOCS_API}/${encodeURIComponent(documentId)}?${params}`);
  return res.json();
}

/** 제안 수락. 이미 사라진 제안이 섞여 있으면 하나씩 다시 시도해 수락된 것만 반환 */
export async function acceptSuggestions(token: string, documentId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const send = (batch: string[]) =>
    gfetch(token, `${DOCS_API}/${encodeURIComponent(documentId)}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: batch.map((suggestionId) => ({ acceptSuggestion: { suggestionId } })) }),
    });
  try {
    await send(ids);
    return ids;
  } catch (e) {
    if (!(e instanceof GoogleApiError) || e.status !== 400 || ids.length === 1) throw e;
    const ok: string[] = [];
    for (const id of ids) {
      try {
        await send([id]);
        ok.push(id);
      } catch (inner) {
        if (!(inner instanceof GoogleApiError) || inner.status !== 400) throw inner;
      }
    }
    return ok;
  }
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** docx로 내보낸 word/document.xml (제안 = 변경 내용 추적, 작성자 · 시각 포함) */
export async function exportDocxDocumentXml(token: string, fileId: string): Promise<string> {
  const url = `${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(DOCX_MIME)}`;
  const buf = await (await gfetch(token, url)).arrayBuffer();
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("docx_without_document_xml");
  return xml;
}

// ---------- 공유 권한 (팀원 ↔ 구글 문서 자동 공유) ----------
export type DrivePermission = { id: string; emailAddress?: string; role: string; type: string };

export async function listPermissions(token: string, fileId: string): Promise<DrivePermission[]> {
  const params = new URLSearchParams({
    fields: "permissions(id,emailAddress,role,type)",
    supportsAllDrives: "true",
    pageSize: "100",
  });
  const res = await gfetch(token, `${API}/files/${encodeURIComponent(fileId)}/permissions?${params}`);
  return (await res.json()).permissions ?? [];
}

/** 편집자 권한 부여 (알림 메일 없음). 이미 있으면 Drive가 기존 권한을 그대로 유지한다. */
export async function grantWriter(token: string, fileId: string, email: string) {
  const params = new URLSearchParams({ sendNotificationEmail: "false", supportsAllDrives: "true" });
  await gfetch(token, `${API}/files/${encodeURIComponent(fileId)}/permissions?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }),
  });
}

export async function deletePermission(token: string, fileId: string, permissionId: string) {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  await gfetch(
    token,
    `${API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?${params}`,
    { method: "DELETE" },
  );
}

/** 새 Google 문서 · 슬라이드 · 시트 생성 (drive.file: 앱이 만든 파일은 바로 접근 가능) */
export async function createGoogleFile(token: string, name: string, mimeType: string): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: "id,name,mimeType,webViewLink", supportsAllDrives: "true" });
  const res = await gfetch(token, `${API}/files?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType }),
  });
  return res.json();
}
