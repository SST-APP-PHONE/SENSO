import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { events } from "../db/schema.js";

type Executor = Pick<Db, "select" | "insert">;

const GENERAL_KEY = "GENERAL";

/** Evento "Emergencia general": destino de reportes sin evento válido. */
export async function getOrCreateDefaultEvent(db: Executor, now = new Date()): Promise<number> {
  const found = await db.select({ id: events.id }).from(events).where(eq(events.systemKey, GENERAL_KEY)).limit(1);
  if (found[0]) return found[0].id;
  // La clave única system_key impide crear dos eventos por defecto en paralelo.
  await db
    .insert(events)
    .values({
      type: "GENERAL",
      name: "Emergencia general",
      description: "Reportes recibidos sin un evento específico activo.",
      isActive: true,
      isDefault: true,
      systemKey: GENERAL_KEY,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({ set: { systemKey: sql`system_key` } });
  // Lectura con bloqueo: dentro de una transacción ve la fila aunque la haya confirmado otra transacción.
  const [row] = await db.select({ id: events.id }).from(events).where(eq(events.systemKey, GENERAL_KEY)).limit(1).for("update");
  return row.id;
}

/**
 * Determina el evento de un reporte. Si el cliente envía un evento existente se respeta
 * (aunque haya sido desactivado mientras el dispositivo estaba sin conexión).
 * Si no, se usa el único evento activo; si hay varios o ninguno, "Emergencia general".
 */
export async function resolveEventId(db: Executor, requested: number | null, now = new Date()): Promise<number> {
  if (requested !== null) {
    const found = await db.select({ id: events.id }).from(events).where(eq(events.id, requested)).limit(1);
    if (found[0]) return found[0].id;
  }
  const active = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.isActive, true), eq(events.isDefault, false)))
    .orderBy(desc(events.startedAt))
    .limit(2);
  if (active.length === 1) return active[0].id;
  return getOrCreateDefaultEvent(db, now);
}
