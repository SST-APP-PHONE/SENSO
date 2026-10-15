import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type mysql from "mysql2/promise";
import { createApp } from "../../server/app.js";
import { createPool, dbFromPool, type Db } from "../../server/db/client.js";
import { loadConfig } from "../../server/lib/config.js";
import { freshDb, testDbUrl } from "./helpers.js";

/**
 * Diagnóstico de producción: la API puede conectarse a una base distinta de la migrada
 * (p. ej. la base por defecto de la cadena de TiDB). /health debe dejarlo claro.
 */
const config = loadConfig({ NODE_ENV: "production" });
let migrated: { db: Db; pool: mysql.Pool };
let otherPool: mysql.Pool;

beforeAll(async () => {
  migrated = await freshDb();
  // Misma credencial, otra base sin tablas de SENSO (accesible para cualquier usuario).
  const u = new URL(testDbUrl());
  u.pathname = "/information_schema";
  otherPool = createPool(u.toString());
});
afterAll(async () => {
  await migrated.pool.end();
  await otherPool.end();
});

describe("/health informa si la base conectada tiene el esquema", () => {
  it("base migrada: schemaReady true y /catalog 200", async () => {
    const app = createApp({ db: migrated.db, config });
    const h = await request(app).get("/senso/api/health");
    expect(h.body).toMatchObject({ ok: true, db: true, dbConfigured: true, schemaReady: true, dbErrorCode: null });
    expect((await request(app).get("/senso/api/catalog")).status).toBe(200);
  });

  it("base sin migrar (otra base): db true pero schemaReady false, y /catalog falla", async () => {
    const app = createApp({ db: dbFromPool(otherPool), config });
    const h = await request(app).get("/senso/api/health");
    expect(h.body).toMatchObject({ ok: true, db: true, dbConfigured: true, schemaReady: false, dbErrorCode: null });
    const c = await request(app).get("/senso/api/catalog");
    expect(c.status).toBe(500);
    expect(c.body).toEqual({ error: "Error interno" });
  });

  it("BD inalcanzable: db false, schemaReady null y código de error sin mensajes ni credenciales", async () => {
    const pool = createPool("mysql://usuario:clave-secreta@127.0.0.1:1/nada");
    const app = createApp({ db: dbFromPool(pool), config });
    const h = await request(app).get("/senso/api/health");
    expect(h.body).toMatchObject({ ok: true, db: false, schemaReady: null, dbErrorCode: "ECONNREFUSED" });
    expect(JSON.stringify(h.body)).not.toMatch(/clave-secreta|usuario|127\.0\.0\.1/);
    await pool.end();
  });
});
