import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";

export const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 12);

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_COST);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
/** Readable temporary password (no ambiguous chars). */
export function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = randomBytes(12);
  let s = "";
  for (const x of b) s += alphabet[x % alphabet.length];
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}
/** Password policy: min 10 chars, at least one letter and one digit. Returns error message or null. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 10) return "Password minimal 10 karakter.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password harus mengandung huruf dan angka.";
  return null;
}
