import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { count, eq } from "drizzle-orm";
import type mysql from "mysql2/promise";
import type { Express } from "express";
import type { Db } from "../../server/db/client.js";
import { events, reportUpdates, reports, syncOperations, users } from "../../server/db/schema.js";
import { createOp, freshDb, testApp, updateOp } from "./helpers.js";

let db: Db;
let pool: mysql.Pool;
let app: Express;

beforeAll(async () => {
  ({ db, pool } = await freshDb());
  app = testApp(db);
});
afterAll(async () => pool.end());
beforeEach(async () => {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of ["report_updates", "sync_operations", "reports", "users", "folio_counters", "events"]) await pool.query(`TRUNCATE TABLE ${t}`);
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
});

const sync = (operations: unknown[]) => request(app).post("/senso/api/sync").send({ operations });
const total = async (table: typeof reports | typeof reportUpdates | typeof syncOperations) => (await db.select({ n: count() }).from(table))[0].n;

describe("POST /api/sync", () => {
  it("crea un reporte y asigna folio oficial consecutivo", async () => {
    const a = createOp();
    const b = createOp();
    const res = await sync([a, b]);
    expect(res.status).toBe(200);
    const year = new Date().getUTCFullYear();
    expect(res.body.results[0]).toMatchObject({ clientOperationId: a.clientOperationId, outcome: "APPLIED", report: { reportId: a.payload.reportId, folio: `SENSO-${year}-000001` } });
    expect(res.body.results[1].report.folio).toBe(`SENSO-${year}-000002`);

    const [row] = await db.select().from(reports).where(eq(reports.clientReportId, a.payload.reportId));
    expect(row).toMatchObject({ category: "electricity", categoryGroup: "SERVICE", currentStatus: "UNAVAILABLE", connectivity: "OFFLINE", latitude: 23.0605, municipality: "Los Cabos" });
    expect(await total(syncOperations)).toBe(2);
    expect((await db.select().from(users)).length).toBe(1); // mismo dispositivo
  });

  it("es idempotente: reenviar la misma operación devuelve DUPLICATE y no duplica", async () => {
    const op = createOp();
    const first = await sync([op]);
    const second = await sync([op]);
    expect(second.body.results[0]).toMatchObject({ outcome: "DUPLICATE", report: first.body.results[0].report });
    expect(await total(reports)).toBe(1);
  });

  it("es seguro ante reintentos concurrentes (misma operación en paralelo)", async () => {
    const op = createOp();
    const responses = await Promise.all(Array.from({ length: 8 }, () => sync([op])));
    const outcomes = responses.map((r) => r.body.results[0].outcome).sort();
    expect(outcomes.filter((o) => o === "APPLIED")).toHaveLength(1);
    expect(outcomes.every((o) => o === "APPLIED" || o === "DUPLICATE")).toBe(true);
    expect(await total(reports)).toBe(1);
    expect(new Set(responses.map((r) => r.body.results[0].report.folio)).size).toBe(1);
  });

  it("folios únicos bajo concurrencia de reportes distintos", async () => {
    const ops = Array.from({ length: 20 }, () => createOp());
    const res = await Promise.all(ops.map((op) => sync([op])));
    const folios = res.map((r) => r.body.results[0].report.folio);
    expect(new Set(folios).size).toBe(20);
  });

  it("misma clave de idempotencia con datos distintos → conflicto, sin sobrescribir", async () => {
    const op = createOp();
    await sync([op]);
    const tampered = { ...op, payload: { ...op.payload, status: "AVAILABLE" } };
    const res = await sync([tampered]);
    expect(res.body.results[0]).toMatchObject({ outcome: "ERROR", error: { code: "OPERATION_CONFLICT", retriable: false } });
    expect((await db.select().from(reports))[0].currentStatus).toBe("UNAVAILABLE");
  });

  it("valida en servidor: datos inválidos se rechazan por operación sin afectar las demás", async () => {
    const good = createOp();
    const badLat = createOp({}, { location: { latitude: 200, longitude: 0, accuracy: 1, capturedAt: new Date().toISOString() } });
    const badCat = createOp({}, { category: "aliens" });
    const future = createOp({}, { createdAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const longComment = createOp({}, { comment: "x".repeat(501) });
    const res = await sync([good, badLat, badCat, future, longComment, { type: "DROP_TABLE" }, "basura"]);
    const r = res.body.results;
    expect(r[0].outcome).toBe("APPLIED");
    for (const i of [1, 2, 3, 4, 5, 6]) expect(r[i]).toMatchObject({ outcome: "ERROR", error: { code: "VALIDATION_ERROR", retriable: false } });
    expect(r[1].clientOperationId).toBe(badLat.clientOperationId);
    expect(await total(reports)).toBe(1);
  });

  it("sanitiza texto: elimina caracteres de control y recorta", async () => {
    const op = createOp({}, { comment: "  hola\u0000\u0007 mundo  " });
    await sync([op]);
    expect((await db.select().from(reports))[0].comment).toBe("hola mundo");
  });

  it("rechaza lotes vacíos, enormes o malformados", async () => {
    expect((await sync([])).status).toBe(400);
    expect((await sync(Array.from({ length: 51 }, () => createOp()))).status).toBe(400);
    expect((await request(app).post("/senso/api/sync").set("Content-Type", "application/json").send("{bad json")).status).toBe(400);
    const huge = await request(app).post("/senso/api/sync").send({ operations: [createOp({}, { comment: "x".repeat(400_000) })] });
    expect(huge.status).toBe(413);
  });

  it("historial: actualización antes de su reporte → REPORT_NOT_FOUND reintetable; después se aplica", async () => {
    const op = createOp();
    const up = updateOp(op.payload.reportId, "AVAILABLE", new Date(Date.now() + 60_000));
    const early = await sync([up]);
    expect(early.body.results[0]).toMatchObject({ outcome: "ERROR", error: { code: "REPORT_NOT_FOUND", retriable: true } });

    const res = await sync([op, up]);
    expect(res.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(["APPLIED", "APPLIED"]);
    const [row] = await db.select().from(reports);
    expect(row.currentStatus).toBe("AVAILABLE");
    expect(row.initialStatus).toBe("UNAVAILABLE");
    expect(await total(reportUpdates)).toBe(1);
    // reintento de la actualización: no duplica
    expect((await sync([up])).body.results[0].outcome).toBe("DUPLICATE");
    expect(await total(reportUpdates)).toBe(1);
  });

  it("actualizaciones desordenadas: el estado vigente es el más reciente por hora de captura", async () => {
    const op = createOp();
    await sync([op]);
    const later = updateOp(op.payload.reportId, "AVAILABLE", new Date(Date.now() + 120_000));
    const earlier = updateOp(op.payload.reportId, "INTERMITTENT", new Date(Date.now() + 60_000));
    await sync([later, earlier]);
    expect((await db.select().from(reports))[0].currentStatus).toBe("AVAILABLE");
    expect(await total(reportUpdates)).toBe(2);
  });

  it("asigna evento: el solicitado si existe; si no, el único activo; si no, 'Emergencia general'", async () => {
    const r1 = await sync([createOp()]);
    const [general] = await db.select().from(events).where(eq(events.isDefault, true));
    expect(r1.body.results[0].report.eventId).toBe(general.id);

    const now = new Date();
    const [h] = await db.insert(events).values({ type: "HURRICANE", name: "Polo 2026", isActive: true, startedAt: now, createdAt: now, updatedAt: now }).$returningId();
    expect((await sync([createOp()])).body.results[0].report.eventId).toBe(h.id);
    expect((await sync([createOp({}, { eventId: general.id })])).body.results[0].report.eventId).toBe(general.id);
    expect((await sync([createOp({}, { eventId: 999999 })])).body.results[0].report.eventId).toBe(h.id);
  });

  it("GET /catalog devuelve eventos activos y /health el estado de la BD", async () => {
    const now = new Date();
    await db.insert(events).values([
      { type: "EARTHQUAKE", name: "Activo", isActive: true, startedAt: now, createdAt: now, updatedAt: now },
      { type: "FIRE", name: "Inactivo", isActive: false, startedAt: now, createdAt: now, updatedAt: now },
    ]);
    const c = await request(app).get("/senso/api/catalog");
    expect(c.body.events.map((e: { name: string }) => e.name)).toEqual(["Activo"]);
    expect(c.headers["cache-control"]).toBe("no-store");
    const h = await request(app).get("/api/health");
    expect(h.body).toMatchObject({ ok: true, db: true });
  });
});
