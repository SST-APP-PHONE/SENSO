import { parseArgs } from "node:util";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../server/db/client.js";
import { adminUsers } from "../server/db/schema.js";
import { hashPassword } from "../server/lib/password.js";

/**
 * Crea o actualiza un usuario administrativo.
 *   npm run admin:create -- --email a@b.com --name "Nombre" --role ADMIN
 * La contraseña se toma de SENSO_ADMIN_PASSWORD (para no dejarla en el historial del shell).
 */
const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "ADMIN" },
  },
});
const email = values.email?.trim().toLowerCase();
const password = process.env.SENSO_ADMIN_PASSWORD ?? "";
const role = values.role === "VIEWER" ? "VIEWER" : "ADMIN";
if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("--email es obligatorio");
if (password.length < 12) throw new Error("Define SENSO_ADMIN_PASSWORD con al menos 12 caracteres");

const db = getDb();
const passwordHash = await hashPassword(password);
await db
  .insert(adminUsers)
  .values({ email, name: values.name ?? email, passwordHash, role, isActive: true, createdAt: new Date() })
  .onDuplicateKeyUpdate({
    set: { passwordHash, role, isActive: true, failedAttempts: 0, lockedUntil: null, sessionVersion: sql`session_version + 1` },
  });
const [u] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email));
console.log(`Administrador listo: ${email} (#${u.id}, ${role})`);
await closeDb();
