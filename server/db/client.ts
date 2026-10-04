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

export function dbFromPool(p: mysql.Pool): Db {
  return drizzle(p, { schema, mode: "default" });
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}
