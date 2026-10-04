import { createHmac, timingSafeEqual } from "node:crypto";

/** Sesión administrativa firmada con HMAC-SHA256 (cookie httpOnly). */
export interface SessionClaims {
  sub: number;
  role: "ADMIN" | "VIEWER";
  ver: number;
  exp: number;
}

export const SESSION_COOKIE = "senso_admin";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueSession(claims: Omit<SessionClaims, "exp">, secret: string, now = Date.now()): string {
  const full: SessionClaims = { ...claims, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): SessionClaims | null {
  if (!token || token.length > 2048) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.sub !== "number" || typeof claims.exp !== "number") return null;
    if (claims.role !== "ADMIN" && claims.role !== "VIEWER") return null;
    if (claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}
