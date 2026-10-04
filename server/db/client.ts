import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";

export type Db = MySql2Database<typeof schema>;

let pool: mysql.Pool | null = null;
let db: Db | null = null;

export function createPool(url: string): mysql.Pool {
  return mysql.createPool({
    uri: url,
    // Pocas conexiones: en Vercel cada instancia serverless abre su propio pool.
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 5),
    timezone: "Z",
    dateStrings: false,
    enableKeepAlive: true,
    // Falla rápido si la BD no responde (las funciones serverless tienen tiempo limitado).
    connectTimeout: 5_000,
  });
}

export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  pool = createPool(url);
  db = drizzle(pool, { schema, mode: "default" });
  return db;
}

export type DbState = { db: Db; configured: true } | { db: null; configured: false; reason: string };

/**
 * Resuelve la conexión SIN lanzar excepciones: la ausencia o invalidez de DATABASE_URL
 * no debe impedir que la API arranque (p. ej. /health debe poder informarlo).
 * El pool de mysql2 es perezoso: no se conecta hasta la primera consulta.
 */
export function resolveDb(env: NodeJS.ProcessEnv = process.env): DbState {
  if (!env.DATABASE_URL) return { db: null, configured: false, reason: "DATABASE_URL no configurada" };
  try {
    if (!db) {
      pool = createPool(env.DATABASE_URL);
      db = drizzle(pool, { schema, mode: "default" });
    }
    return { db, configured: true };
  } catch {
    // Nunca se incluye el valor de la URL (contiene credenciales).
    return { db: null, configured: false, reason: "DATABASE_URL inválida" };
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
