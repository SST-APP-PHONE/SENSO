import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";

export type Db = MySql2Database<typeof schema>;

let pool: mysql.Pool | null = null;
let db: Db | null = null;

/**
 * Destino de conexión: una URL (DATABASE_URL) o parámetros separados (DB_*).
 * Con parámetros DB_* siempre se exige TLS verificando el certificado (TiDB Cloud lo requiere).
 */
export type ConnectionTarget =
  | { kind: "url"; uri: string }
  | {
      kind: "params";
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      ssl: { minVersion: "TLSv1.2"; rejectUnauthorized: true };
    };

const DB_PARAM_VARS = ["DB_HOST", "DB_USERNAME", "DB_PASSWORD", "DB_DATABASE"] as const;
const DB_DEFAULT_PORT = 4000;

export const DB_NOT_CONFIGURED =
  "Base de datos no configurada: define DATABASE_URL o DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD y DB_DATABASE";

/**
 * Elige la conexión a partir del entorno, sin lanzar excepciones:
 *  1. DATABASE_URL, si existe (comportamiento existente; es lo que usa Vercel).
 *  2. Si no, DB_HOST, DB_PORT (por defecto 4000), DB_USERNAME, DB_PASSWORD y DB_DATABASE, con TLS.
 * Los mensajes de error solo nombran variables; nunca incluyen sus valores.
 */
export function connectionFromEnv(env: NodeJS.ProcessEnv = process.env): { target: ConnectionTarget } | { error: string } {
  if (env.DATABASE_URL) return { target: { kind: "url", uri: env.DATABASE_URL } };

  const present = DB_PARAM_VARS.filter((k) => env[k]);
  if (present.length === 0 && !env.DB_PORT) return { error: DB_NOT_CONFIGURED };
  const missing = DB_PARAM_VARS.filter((k) => !env[k]);
  if (missing.length) return { error: `Faltan variables de base de datos: ${missing.join(", ")}` };

  const port = env.DB_PORT ? Number(env.DB_PORT) : DB_DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "DB_PORT inválido" };

  return {
    target: {
      kind: "params",
      host: env.DB_HOST!,
      port,
      user: env.DB_USERNAME!,
      password: env.DB_PASSWORD!,
      database: env.DB_DATABASE!,
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    },
  };
}

export function createPool(target: string | ConnectionTarget): mysql.Pool {
  const t: ConnectionTarget = typeof target === "string" ? { kind: "url", uri: target } : target;
  const common = {
    // Pocas conexiones: en Vercel cada instancia serverless abre su propio pool.
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 5),
    timezone: "Z",
    dateStrings: false,
    enableKeepAlive: true,
    // Falla rápido si la BD no responde (las funciones serverless tienen tiempo limitado).
    connectTimeout: 5_000,
  };
  if (t.kind === "url") return mysql.createPool({ uri: t.uri, ...common });
  const { kind: _kind, ...params } = t;
  return mysql.createPool({ ...params, ...common });
}

export function getDb(): Db {
  if (db) return db;
  const conn = connectionFromEnv();
  if ("error" in conn) throw new Error(conn.error);
  pool = createPool(conn.target);
  db = drizzle(pool, { schema, mode: "default" });
  return db;
}

export type DbState = { db: Db; configured: true } | { db: null; configured: false; reason: string };

/**
 * Resuelve la conexión SIN lanzar excepciones: la ausencia o invalidez de la configuración
 * (DATABASE_URL o DB_*) no debe impedir que la API arranque (p. ej. /health debe poder informarlo).
 * El pool de mysql2 es perezoso: no se conecta hasta la primera consulta.
 */
export function resolveDb(env: NodeJS.ProcessEnv = process.env): DbState {
  const conn = connectionFromEnv(env);
  if ("error" in conn) return { db: null, configured: false, reason: conn.error };
  try {
    if (!db) {
      pool = createPool(conn.target);
      db = drizzle(pool, { schema, mode: "default" });
    }
    return { db, configured: true };
  } catch {
    // Nunca se incluye el valor de la configuración (contiene credenciales).
    return { db: null, configured: false, reason: conn.target.kind === "url" ? "DATABASE_URL inválida" : "Configuración DB_* inválida" };
  }
}

export function dbFromPool(p: mysql.Pool): Db {
  return drizzle(p, { schema, mode: "default" });
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}
