import { describe, expect, it } from "vitest";
import { ipPrefix } from "../../server/lib/privacy.js";
import { hashPassword, verifyPassword } from "../../server/lib/password.js";
import { issueSession, verifySession } from "../../server/lib/session.js";
import { formatFolio, startOfDayInTimezone } from "../../server/lib/time.js";
import { loadConfig } from "../../server/lib/config.js";

describe("Utilidades de servidor", () => {
  it("IP truncada", () => {
    expect(ipPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefix("::ffff:10.1.2.3")).toBe("10.1.2.0/24");
    expect(ipPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(ipPrefix("nope")).toBeNull();
  });
  it("contraseñas con scrypt", async () => {
    const h = await hashPassword("secreto-largo-123");
    expect(h).not.toContain("secreto");
    expect(await verifyPassword("secreto-largo-123", h)).toBe(true);
    expect(await verifyPassword("otro", h)).toBe(false);
  });
  it("sesiones firmadas y con expiración", () => {
    const t = issueSession({ sub: 1, role: "ADMIN", ver: 1 }, "s".repeat(40), 0);
    expect(verifySession(t, "s".repeat(40), 1000)?.sub).toBe(1);
    expect(verifySession(t, "x".repeat(40), 1000)).toBeNull();
    expect(verifySession(t, "s".repeat(40), 9 * 3600 * 1000)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), role: "ADMIN", sub: 2 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, "s".repeat(40), 1000)).toBeNull();
  });
  it("folio y zona horaria", () => {
    expect(formatFolio(2026, 1)).toBe("SENSO-2026-000001");
    // 2026-10-04 03:00 UTC = 2026-10-03 21:00 en CDMX (UTC-6) → inicio del día 2026-10-03T06:00Z
    expect(startOfDayInTimezone(new Date("2026-10-04T03:00:00Z"), "America/Mexico_City").toISOString()).toBe("2026-10-03T06:00:00.000Z");
  });
  it("ADMIN_SECRET obligatorio en producción", () => {
    expect(() => loadConfig({ NODE_ENV: "production", ADMIN_SECRET: "corto" })).toThrow();
    expect(loadConfig({ NODE_ENV: "production", ADMIN_SECRET: "x".repeat(40), SENSO_DISABLE_RATE_LIMIT: "1" }).disableRateLimit).toBe(false);
  });
});
