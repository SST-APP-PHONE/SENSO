import mysql from "mysql2/promise";
import { E2E_DB } from "../../playwright.config.js";

/** Consulta directa a la BD E2E para verificar lo que el servidor realmente guardó. */
export async function query<T = mysql.RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await mysql.createConnection({ uri: E2E_DB, timezone: "Z" });
  try {
    const [rows] = await conn.query(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}
