import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { createApp } from "../../server/app.js";
import { createPool, dbFromPool, type Db } from "../../server/db/client.js";
import { adminUsers } from "../../server/db/schema.js";
import { loadConfig } from "../../server/lib/config.js";
import { hashPassword } from "../../server/lib/password.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));

export function testDbUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Define TEST_DATABASE_URL para las pruebas de servidor");
  if (!/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL debe apuntar a una BD cuyo nombre contenga 'test' (se borra)");
  return url;
}

/** BD limpia: borra todas las tablas y aplica las migraciones. */
export async function freshDb(): Promise<{ db: Db; pool: mysql.Pool }> {
  const pool = createPool(testDbUrl());
  const [tables] = await pool.query<mysql.RowDataPacket[]>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await pool.query(`DROP TABLE IF EXISTS \`${t}\``);
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  const db = dbFromPool(pool);
  await migrate(db, { migrationsFolder: path.join(root, "drizzle") });
  return { db, pool };
}

export function testApp(db: Db, opts: { rateLimit?: boolean } = {}) {
  const config = loadConfig({
    ADMIN_SECRET: "test-secret-0123456789-0123456789-abcdef",
    APP_TIMEZONE: "America/Mexico_City",
    SENSO_DISABLE_RATE_LIMIT: opts.rateLimit ? "0" : "1",
    NODE_ENV: "test",
  });
  return createApp({ db, config });
}

export async function createAdmin(db: Db, email: string, password: string, role: "ADMIN" | "VIEWER" = "ADMIN") {
  await db.insert(adminUsers).values({ email, name: email, passwordHash: await hashPassword(password), role, isActive: true, createdAt: new Date() });
}

export function createOp(overrides: Record<string, unknown> = {}, payloadOverrides: Record<string, unknown> = {}) {
  const reportId = randomUUID();
  return {
    type: "CREATE_REPORT" as const,
    clientOperationId: randomUUID(),
    ...overrides,
    payload: {
      reportId,
      localFolio: "SENSO-2026-P-ABCDEF",
      eventId: null,
      category: "electricity",
      status: "UNAVAILABLE",
      severity: "HIGH",
      comment: "Sin luz",
      municipality: "Los Cabos",
      location: { latitude: 23.0605, longitude: -109.6977, accuracy: 12, capturedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      timezoneOffsetMinutes: -420,
      connectivity: "OFFLINE",
      device: { deviceId: "11111111-1111-4111-8111-111111111111", platform: "Android" },
      ...payloadOverrides,
    },
  };
}

export function updateOp(reportId: string, status: string, createdAt = new Date()) {
  return {
    type: "ADD_UPDATE" as const,
    clientOperationId: randomUUID(),
    payload: {
      updateId: randomUUID(),
      reportId,
      status,
      comment: null,
      location: null,
      createdAt: createdAt.toISOString(),
      timezoneOffsetMinutes: -420,
      connectivity: "ONLINE",
      device: { deviceId: "11111111-1111-4111-8111-111111111111" },
    },
  };
}
