"use client";
// 회원가입 — 학생 / 교수를 고르고 한양대 구글 계정으로 가입한다.
//  고른 값(역할 · 학번 · 학과)은 10분짜리 쿠키에 담아 /auth/callback 이 읽어 complete_signup()으로 저장한다.
//  교수는 바로 권한이 생기지 않는다: 등록된 교수 메일이면 즉시, 아니면 학교 확인 후 (DB에서 결정).
import Link from "next/link";
import { useState } from "react";
import { GraduationCap, Presentation } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LAMP_GOOGLE_LOGIN_ORIGIN, LOGIN_DRIVE_SCOPES, LOGIN_QUERY_PARAMS } from "@/lib/google/scopes";
import { SIGNUP_COOKIE, type SignupRole as Role } from "@/lib/signup";
import { GoogleIcon } from "../AuthCard";

const ROLES: {
  id: Role;
  title: string;
  body: string;
  icon: typeof GraduationCap;
}[] = [
  {
    id: "student",
    title: "학생",
    body: "팀플을 만들거나 참여하고, 내 기여를 기록해요.",
    icon: GraduationCap,
  },
  {
    id: "professor",
    title: "교수",
    body: "수업을 열고 팀들의 협업 기록을 살펴봐요.",
    icon: Presentation,
  },
];

export function SignupForm() {
  const [role, setRole] = useState<Role>("student");
  const [studentNo, setStudentNo] = useState("");
  const [department, setDepartment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const studentNoInvalid =
    role === "student" && studentNo !== "" && !/^\d{10}$/.test(studentNo);

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    if (studentNoInvalid) return;
    setPending(true);
    setError(null);
    const intent = JSON.stringify({
      role,
      studentNo: role === "student" ? studentNo.trim() : "",
      department: department.trim(),
    });
    document.cookie = `${SIGNUP_COOKIE}=${encodeURIComponent(intent)}; Path=/; Max-Age=600; SameSite=Lax${
      location.protocol === "https:" ? "; Secure" : ""
    }`;
    if (window.location.origin === LAMP_GOOGLE_LOGIN_ORIGIN) {
      window.location.assign(new URL("/auth/google?signup=1", LAMP_GOOGLE_LOGIN_ORIGIN));
      return;
    }
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?signup=1`,
        scopes: LOGIN_DRIVE_SCOPES,
        queryParams: LOGIN_QUERY_PARAMS,
      },
    });
    if (error) {
      setPending(false);
      setError("구글 로그인을 시작하지 못했어요. 다시 시도해 주세요.");
    }
  }

  return (
    <form className="lamp-auth-body" onSubmit={signup}>
      <fieldset className="lamp-auth-roles">
        <legend>어떤 계정으로 가입할까요?</legend>
        {ROLES.map((r) => (
          <label key={r.id} className="lamp-auth-role">
            <input
              type="radio"
              name="role"
              value={r.id}
              checked={role === r.id}
              onChange={() => setRole(r.id)}
            />
            <r.icon size={20} aria-hidden="true" />
            <span>
              <strong>{r.title}</strong>
              <small>{r.body}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {role === "student" ? (
        <>
          <label className="lamp-field-label" htmlFor="student-no">
            학번 <span>(선택)</span>
          </label>
          <input
            id="student-no"
            className="lamp-input"
            inputMode="numeric"
            autoComplete="off"
            placeholder="2026012345"
            value={studentNo}
            aria-invalid={studentNoInvalid}
            aria-describedby={studentNoInvalid ? "student-no-error" : undefined}
            onChange={(e) => setStudentNo(e.target.value.replace(/\s/g, ""))}
          />
          {studentNoInvalid && (
            <p id="student-no-error" className="lamp-auth-error">
              학번은 숫자 10자리예요.
            </p>
          )}
        </>
      ) : (
        <p className="lamp-auth-note">
          교수 계정은 학교 확인 후 열려요. 학교에 등록된 교수 메일이면
          가입하자마자 바로 쓸 수 있고, 아니면 확인을 기다리는 동안 학생 화면을
          쓸 수 있어요.
        </p>
      )}

      <label className="lamp-field-label" htmlFor="department">
        {role === "student" ? "학과" : "소속 학과"} <span>(선택)</span>
      </label>
      <input
        id="department"
        className="lamp-input"
        autoComplete="organization-title"
        placeholder={
          role === "student" ? "컴퓨터소프트웨어학부" : "정보시스템학과"
        }
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
      />

      <button
        className="lamp-auth-google"
        disabled={pending || studentNoInvalid}
      >
        <GoogleIcon />
        한양대 구글 계정으로 {role === "student" ? "학생" : "교수"} 가입
      </button>
      <p className="lamp-auth-hint">
        이름과 메일은 구글 계정에서 가져와요. @hanyang.ac.kr 계정만 가입할 수
        있어요.
      </p>
      {error && (
        <p className="lamp-auth-error" role="alert">
          {error}
        </p>
      )}
      <p className="lamp-auth-switch">
        이미 계정이 있나요? <Link href="/login">로그인</Link>
      </p>
    </form>
  );
}
