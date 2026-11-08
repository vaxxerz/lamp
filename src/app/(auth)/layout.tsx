// 로그인 · 회원가입 — 학생 /lamp와 같은 디자인 시스템(lamp.css 토큰)을 쓴다
import type { Metadata } from "next";
import "../(lamp)/lamp/lamp.css";
import "./auth.css";

export const metadata: Metadata = {
  title: "Lamp · 로그인",
  description: "한양대학교 구글 계정으로 로그인하거나 학생 · 교수로 가입해요.",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="lamp-app lamp-auth">{children}</div>;
}
