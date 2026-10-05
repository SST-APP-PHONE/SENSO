import { afterAll, describe, expect, it } from "vitest";
import { DB_NOT_CONFIGURED, closeDb, connectionFromEnv, createPool, resolveDb } from "../../server/db/client.js";
import { testDbUrl } from "./helpers.js";

/** Configuración de conexión: DATABASE_URL (prioritaria) o variables DB_* con TLS obligatorio. */
const DB_VARS = { DB_HOST: "db.example.test", DB_PORT: "4000", DB_USERNAME: "usuario", DB_PASSWORD: "clave-secreta", DB_DATABASE: "senso" };

afterAll(async () => closeDb());

describe("connectionFromEnv", () => {
  it("DATABASE_URL tiene prioridad sobre DB_* (comportamiento existente)", () => {
    const r = connectionFromEnv({ DATABASE_URL: "mysql://u:p@h:3306/x", ...DB_VARS });
    expect(r).toEqual({ target: { kind: "url", uri: "mysql://u:p@h:3306/x" } });
  });

  it("sin DATABASE_URL usa DB_* con TLS verificando el certificado", () => {
    const r = connectionFromEnv(DB_VARS);
    expect(r).toEqual({
      target: {
        kind: "params",
        host: "db.example.test",
        port: 4000,
        user: "usuario",
        password: "clave-secreta",
        database: "senso",
        ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      },
    });
  });

  it("DB_PORT es opcional (4000, puerto de TiDB) y se valida", () => {
    const { DB_PORT: _omit, ...withoutPort } = DB_VARS;
    expect(connectionFromEnv(withoutPort)).toMatchObject({ target: { port: 4000 } });
    expect(connectionFromEnv({ ...DB_VARS, DB_PORT: "3306" })).toMatchObject({ target: { port: 3306 } });
    for (const bad of ["abc", "0", "70000", "40.5"]) expect(connectionFromEnv({ ...DB_VARS, DB_PORT: bad })).toEqual({ error: "DB_PORT inválido" });
  });

  it("sin configuración, o con DB_* incompleta, informa qué falta sin exponer valores", () => {
    expect(connectionFromEnv({})).toEqual({ error: DB_NOT_CONFIGURED });
    const partial = connectionFromEnv({ DB_HOST: "db.example.test", DB_PASSWORD: "clave-secreta" });
    expect(partial).toEqual({ error: "Faltan variables de base de datos: DB_USERNAME, DB_DATABASE" });
    expect(JSON.stringify(partial)).not.toContain("clave-secreta");
    expect(resolveDb({ DB_HOST: "db.example.test", DB_PASSWORD: "clave-secreta" })).toEqual({
      db: null,
      configured: false,
      reason: "Faltan variables de base de datos: DB_USERNAME, DB_DATABASE",
    });
  });

  it("resolveDb con DB_* completas queda configurada (el pool es perezoso: no conecta aún)", () => {
    expect(resolveDb(DB_VARS)).toMatchObject({ configured: true });
  });
});

describe("TLS obligatorio con DB_*", () => {
  it("nunca cae a una conexión sin cifrar: un servidor sin TLS o con certificado no confiable es rechazado", async () => {
    // Mismas credenciales que la BD de pruebas, pero por la vía DB_* (TLS + verificación de certificado).
    // La BD de pruebas no tiene un certificado confiable, así que la conexión DEBE fallar.
    const u = new URL(testDbUrl());
    const conn = connectionFromEnv({
      DB_HOST: u.hostname,
      DB_PORT: u.port || "3306",
      DB_USERNAME: decodeURIComponent(u.username),
      DB_PASSWORD: decodeURIComponent(u.password),
      DB_DATABASE: u.pathname.slice(1),
    });
    if ("error" in conn) throw new Error(conn.error);
    const pool = createPool(conn.target);
    await expect(pool.query("SELECT 1")).rejects.toThrow(/secure|ssl|tls|certificate|self[- ]signed/i);
    await pool.end();

    // Control: la misma BD por DATABASE_URL (sin TLS) sí responde.
    const plain = createPool(testDbUrl());
    await expect(plain.query("SELECT 1")).resolves.toBeTruthy();
    await plain.end();
  });
});
