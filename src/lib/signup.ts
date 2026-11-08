// 회원가입 의사(역할 · 학번 · 학과) — 가입 화면이 쿠키로 남기고 /auth/callback 이 읽는다.
// 쿠키 값은 사용자가 바꿀 수 있으니 여기서는 모양만 검사한다. 교수 권한은 DB(complete_signup)가 결정.
export const SIGNUP_COOKIE = "lamp_signup";

export type SignupRole = "student" | "professor";
export interface SignupIntent {
  role: SignupRole;
  studentNo: string;
  department: string;
}

export function parseSignupIntent(
  raw: string | undefined,
): SignupIntent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<SignupIntent>;
    if (v.role !== "student" && v.role !== "professor") return null;
    const studentNo =
      typeof v.studentNo === "string" && /^\d{10}$/.test(v.studentNo)
        ? v.studentNo
        : "";
    const department =
      typeof v.department === "string" ? v.department.trim().slice(0, 60) : "";
    return { role: v.role, studentNo, department };
  } catch {
    return null;
  }
}

/** complete_signup() 결과 → 가입 직후 갈 곳 */
export function homeAfterSignup(result: string) {
  return result === "professor"
    ? "/professor"
    : result === "pending"
      ? "/signup/pending"
      : "/lamp";
}
