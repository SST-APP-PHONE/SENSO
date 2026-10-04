import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { syncRequestSchema, type CatalogResponse, type SyncResponse } from "../../shared/schemas.js";
import type { Db } from "../db/client.js";
import { events } from "../db/schema.js";
import { processBatch } from "../services/sync.js";

export function publicRouter(db: Db): Router {
  const r = Router();

  r.get("/health", async (_req, res) => {
    const dbOk = await db.execute(sql`SELECT 1`).then(
      () => true,
      () => false,
    );
    res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk, serverTime: new Date().toISOString() });
  });

  /** Catálogo dinámico (eventos activos). El cliente lo guarda en IndexedDB para usarlo sin conexión. */
  r.get("/catalog", async (_req, res) => {
    const rows = await db.select().from(events).where(eq(events.isActive, true)).orderBy(asc(events.isDefault), asc(events.startedAt));
    const body: CatalogResponse = {
      events: rows.map((e) => ({ id: e.id, type: e.type, name: e.name, isActive: e.isActive, startedAt: e.startedAt.toISOString() })),
      serverTime: new Date().toISOString(),
    };
    res.set("Cache-Control", "no-store").json(body);
  });

  /** Recepción de la cola offline. Idempotente por clientOperationId. */
  r.post("/sync", async (req, res) => {
    const parsed = syncRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Lote inválido" });
    const results = await processBatch(db, parsed.data.operations);
    const body: SyncResponse = { results, serverTime: new Date().toISOString() };
    res.set("Cache-Control", "no-store").json(body);
  });

  return r;
}
