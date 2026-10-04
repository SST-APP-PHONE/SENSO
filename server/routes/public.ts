import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { syncRequestSchema, type CatalogResponse, type SyncResponse } from "../../shared/schemas.js";
import type { Db } from "../db/client.js";
import type { ServerConfig } from "../lib/config.js";
import { events } from "../db/schema.js";
import { processBatch } from "../services/sync.js";

/**
 * Estado del servicio. Responde SIEMPRE (aunque falte configuración o la BD esté caída):
 * ok = la API está viva; db = la base de datos responde. Nunca expone valores de configuración.
 */
export function healthRouter(db: Db | null, config: ServerConfig): Router {
  const r = Router();
  r.get("/health", async (_req, res) => {
    const dbOk = db
      ? await db.execute(sql`SELECT 1`).then(
          () => true,
          () => false,
        )
      : false;
    res.json({ ok: true, db: dbOk, dbConfigured: db !== null, adminConfigured: config.adminConfigured, serverTime: new Date().toISOString() });
  });
  return r;
}

export function publicRouter(db: Db): Router {
  const r = Router();

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
