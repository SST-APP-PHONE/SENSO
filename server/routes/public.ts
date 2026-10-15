import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { syncRequestSchema, type CatalogResponse, type SyncResponse } from "../../shared/schemas.js";
import type { Db } from "../db/client.js";
import type { ServerConfig } from "../lib/config.js";
import { events } from "../db/schema.js";
import { processBatch } from "../services/sync.js";

/** Código de error de MySQL/red (p. ej. ER_NO_SUCH_TABLE, ER_ACCESS_DENIED_ERROR). Nunca el mensaje: puede incluir usuario o host. */
function errorCode(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" && /^[A-Z0-9_]{2,64}$/.test(code) ? code : "UNKNOWN";
}

/**
 * Estado del servicio. Responde SIEMPRE (aunque falte configuración o la BD esté caída):
 * ok = la API está viva; db = la base de datos responde; schemaReady = la base de datos a la que
 * está conectada la API tiene las tablas de SENSO (migración aplicada en ESA base);
 * dbErrorCode = código del error, si lo hubo. Nunca expone valores de configuración.
 */
export function healthRouter(db: Db | null, config: ServerConfig): Router {
  const r = Router();
  r.get("/health", async (_req, res) => {
    let dbOk = false;
    let schemaReady: boolean | null = null;
    let dbErrorCode: string | null = null;
    if (db) {
      try {
        await db.execute(sql`SELECT 1`);
        dbOk = true;
        const [rows] = (await db.execute(
          sql`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND BINARY table_name = 'events'`,
        )) as unknown as [{ n: number | string }[]];
        schemaReady = Number(rows[0]?.n ?? 0) > 0;
      } catch (err) {
        dbErrorCode = errorCode(err);
      }
    }
    res.json({
      ok: true,
      db: dbOk,
      dbConfigured: db !== null,
      schemaReady,
      dbErrorCode,
      adminConfigured: config.adminConfigured,
      adminConfigIssue: config.adminConfigIssue,
      serverTime: new Date().toISOString(),
    });
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
