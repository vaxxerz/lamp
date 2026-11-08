// 클라이언트 · 서버 공용: 한양 구글 로그인 때 함께 받는 드라이브 범위
//  drive.file: 사용자가 Picker로 고른 파일만 / drive.activity.readonly: 구간별 실제 편집자
export const LOGIN_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.activity.readonly",
].join(" ");

/** refresh token을 받으려면 offline + consent (계정 선택 화면도 함께) */
export const LOGIN_QUERY_PARAMS = {
  hd: "hanyang.ac.kr",
  access_type: "offline",
  prompt: "consent select_account",
  include_granted_scopes: "true",
};

export const LAMP_GOOGLE_LOGIN_ORIGIN = "https://hy-lamp.space";
