// 서버 전용: 구글 refresh token 암호화 (AES-256-GCM). 키: GOOGLE_TOKEN_ENC_KEY (32바이트 base64)
//   생성: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const raw = process.env.GOOGLE_TOKEN_ENC_KEY;
  if (!raw) throw new Error("GOOGLE_TOKEN_ENC_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("GOOGLE_TOKEN_ENC_KEY must be 32 bytes (base64)");
  return buf;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
