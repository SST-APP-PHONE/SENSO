import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { createPool, dbFromPool, resolveDb } from "../../server/db/client.js";
import { loadConfig } from "../../server/lib/config.js";

/**
 * Regresión de FUNCTION_INVOCATION_FAILED en Vercel: la API no debe fallar al arrancar
 * si faltan DATABASE_URL o ADMIN_SECRET, y /health debe informarlo.
 */
const prodNoSecret = loadConfig({ NODE_ENV: "production" });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Arranque sin configuración", () => {
  it("resolveDb no lanza: falta DATABASE_URL o es inválida (sin filtrar su valor)", () => {
    expect(resolveDb({})).toEqual({ db: null, configured: false, reason: "DATABASE_URL no configurada" });
    const bad = resolveDb({ DATABASE_URL: "no es una url ::: secreto123" });
    expect(bad).toMatchObject({ configured: false, reason: "DATABASE_URL inválida" });
    expect(JSON.stringify(bad)).not.toContain("secreto123");
  });

  it("sin base de datos: /health responde 200 {ok:true, db:false}; el resto 503 claro", async () => {
    const app = createApp({ db: null, config: prodNoSecret });
    for (const prefix of ["/senso/api", "/api"]) {
      const h = await request(app).get(`${prefix}/health`);
      expect(h.status).toBe(200);
      expect(h.body).toMatchObject({ ok: true, db: false, dbConfigured: false, adminConfigured: false });
    }
    const catalog = await request(app).get("/senso/api/catalog");
    expect(catalog.status).toBe(503);
    expect(catalog.body.error).toMatch(/base de datos no configurada/);
    expect((await request(app).post("/senso/api/sync").send({ operations: [] })).status).toBe(503);
    expect((await request(app).post("/senso/api/admin/login").set("X-Senso-Request", "1").send({})).status).toBe(503);
  });

  it("BD configurada pero inalcanzable: /health responde rápido con db:false (sin crash)", async () => {
    const pool = createPool("mysql://u:p@127.0.0.1:1/nada");
    const app = createApp({ db: dbFromPool(pool), config: prodNoSecret });
    const t0 = Date.now();
    const h = await request(app).get("/senso/api/health");
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ ok: true, db: false, dbConfigured: true });
    expect(Date.now() - t0).toBeLessThan(6_000);
    await pool.end();
  });

  it("producción sin ADMIN_SECRET: la API pública funciona y el admin responde 503", async () => {
    const pool = createPool("mysql://u:p@127.0.0.1:1/nada");
    const app = createApp({ db: dbFromPool(pool), config: prodNoSecret });
    const r = await request(app).get("/senso/api/admin/me");
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/ADMIN_SECRET/);
    await pool.end();
  });

  it("el punto de entrada de Vercel (api/index.ts) carga sin DATABASE_URL ni ADMIN_SECRET", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("ADMIN_SECRET", "");
    const { default: handler } = await import("../../api/index.js");
    const res = await request(handler as Parameters<typeof request>[0]).get("/senso/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: false, dbConfigured: false, adminConfigured: false });
  });
});
