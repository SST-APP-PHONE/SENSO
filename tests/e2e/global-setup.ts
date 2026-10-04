import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { createPool, dbFromPool } from "../../server/db/client.js";
import { adminUsers, events } from "../../server/db/schema.js";
import { hashPassword } from "../../server/lib/password.js";
import { E2E_DB } from "../../playwright.config.js";

export const ADMIN = { email: "monitor@senso.test", password: "E2E-Contraseña-Segura-1" };

/** BD E2E limpia + un administrador + un evento activo (datos de prueba, no de la app). */
export default async function globalSetup() {
  if (!/test/i.test(new URL(E2E_DB).pathname)) throw new Error("La BD E2E debe contener 'test' en su nombre");
  const pool = createPool(E2E_DB);
  const [tables] = await pool.query<mysql.RowDataPacket[]>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await pool.query(`DROP TABLE IF EXISTS \`${t}\``);
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  const db = dbFromPool(pool);
  await migrate(db, { migrationsFolder: path.resolve("drizzle") });
  const now = new Date();
  await db.insert(adminUsers).values({ email: ADMIN.email, name: "Monitor E2E", passwordHash: await hashPassword(ADMIN.password), role: "ADMIN", isActive: true, createdAt: now });
  await db.insert(events).values({ type: "HURRICANE", name: "Polo 2026", isActive: true, startedAt: now, createdAt: now, updatedAt: now });
  await pool.end();
}
