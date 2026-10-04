import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getCategory } from "../../shared/catalogs.js";
import {
  syncOperationSchema,
  type AddUpdatePayload,
  type CreateReportPayload,
  type SyncErrorCode,
  type SyncOperation,
  type SyncResult,
} from "../../shared/schemas.js";
import type { Db } from "../db/client.js";
import { folioCounters, reportUpdates, reports, syncOperations, users } from "../db/schema.js";
import { formatFolio } from "../lib/time.js";
import { resolveEventId } from "./events.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Margen tolerado para relojes de dispositivos adelantados. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

class OperationError extends Error {
  constructor(
    public code: SyncErrorCode,
    message: string,
    public retriable: boolean,
  ) {
    super(message);
  }
}

function errorResult(clientOperationId: string | null, code: SyncErrorCode, message: string, retriable: boolean): SyncResult {
  return { clientOperationId, outcome: "ERROR", error: { code, message, retriable } };
}

function hashOperation(op: SyncOperation): string {
  return createHash("sha256").update(JSON.stringify(op)).digest("hex");
}

function isDuplicateKey(err: unknown): boolean {
  const e = err as { errno?: number; code?: string; cause?: { errno?: number; code?: string } };
  return e?.errno === 1062 || e?.code === "ER_DUP_ENTRY" || e?.cause?.errno === 1062 || e?.cause?.code === "ER_DUP_ENTRY";
}

function isDeadlock(err: unknown): boolean {
  const e = err as { errno?: number; cause?: { errno?: number } };
  const n = e?.errno ?? e?.cause?.errno;
  return n === 1213 || n === 1205;
}

/** InnoDB puede abortar transacciones concurrentes por deadlock: se reintentan (son idempotentes). */
async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isDeadlock(err) || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30));
    }
  }
}

function extractOperationId(raw: unknown): string | null {
  const v = (raw as { clientOperationId?: unknown })?.clientOperationId;
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

function checkClock(dateIso: string, now: Date, field: string) {
  if (new Date(dateIso).getTime() - now.getTime() > MAX_CLOCK_SKEW_MS) {
    throw new OperationError("VALIDATION_ERROR", `${field} está en el futuro`, false);
  }
}

async function upsertUser(tx: Tx, device: { deviceId: string; platform?: string }, now: Date): Promise<number> {
  await tx
    .insert(users)
    .values({ deviceId: device.deviceId, platform: device.platform ?? null, firstSeenAt: now, lastSeenAt: now })
    .onDuplicateKeyUpdate({ set: { lastSeenAt: now, platform: device.platform ?? sql`platform` } });
  // FOR UPDATE: lectura actual (no la instantánea REPEATABLE READ), por si otra transacción creó la fila.
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.deviceId, device.deviceId)).limit(1).for("update");
  return u.id;
}

async function nextFolio(tx: Tx, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  await tx
    .insert(folioCounters)
    .values({ year, lastValue: 1 })
    .onDuplicateKeyUpdate({ set: { lastValue: sql`${folioCounters.lastValue} + 1` } });
  // La fila quedó bloqueada por la escritura anterior dentro de esta transacción.
  const [row] = await tx.select({ v: folioCounters.lastValue }).from(folioCounters).where(eq(folioCounters.year, year)).for("update");
  return formatFolio(year, row.v);
}

async function findAppliedResult(db: Db | Tx, clientOperationId: string) {
  const rows = await db
    .select({
      payloadHash: syncOperations.payloadHash,
      reportId: reports.clientReportId,
      serverId: reports.id,
      folio: reports.folio,
      eventId: reports.eventId,
    })
    .from(syncOperations)
    .innerJoin(reports, eq(reports.id, syncOperations.reportId))
    .where(eq(syncOperations.clientOperationId, clientOperationId))
    .limit(1);
  return rows[0] ?? null;
}

async function applyCreate(tx: Tx, clientOperationId: string, p: CreateReportPayload, hash: string, now: Date) {
  checkClock(p.createdAt, now, "createdAt");
  if (p.location) checkClock(p.location.capturedAt, now, "location.capturedAt");

  const existing = await tx.select({ id: reports.id }).from(reports).where(eq(reports.clientReportId, p.reportId)).limit(1);
  if (existing[0]) {
    throw new OperationError("OPERATION_CONFLICT", "El reporte ya existe con otra operación", false);
  }
  const category = getCategory(p.category)!;
  const userId = await upsertUser(tx, p.device, now);
  const eventId = await resolveEventId(tx, p.eventId, now);
  const folio = await nextFolio(tx, now);
  const createdAt = new Date(p.createdAt);

  const [inserted] = await tx
    .insert(reports)
    .values({
      clientReportId: p.reportId,
      clientOperationId,
      folio,
      localFolio: p.localFolio,
      eventId,
      userId,
      categoryGroup: category.group,
      category: category.code,
      initialStatus: p.status,
      currentStatus: p.status,
      severity: p.severity,
      comment: p.comment || null,
      municipality: p.municipality || null,
      latitude: p.location?.latitude ?? null,
      longitude: p.location?.longitude ?? null,
      accuracyM: p.location?.accuracy ?? null,
      locationCapturedAt: p.location ? new Date(p.location.capturedAt) : null,
      createdAtClient: createdAt,
      timezoneOffsetMin: p.timezoneOffsetMinutes,
      connectivity: p.connectivity,
      receivedAt: now,
      lastStatusAt: createdAt,
      updatedAt: now,
    })
    .$returningId();

  await tx.insert(syncOperations).values({
    clientOperationId,
    type: "CREATE_REPORT",
    payloadHash: hash,
    userId,
    reportId: inserted.id,
    receivedAt: now,
  });
  return { reportId: p.reportId, serverId: inserted.id, folio, eventId };
}

async function applyUpdate(tx: Tx, clientOperationId: string, p: AddUpdatePayload, hash: string, now: Date) {
  checkClock(p.createdAt, now, "createdAt");
  if (p.location) checkClock(p.location.capturedAt, now, "location.capturedAt");

  const [report] = await tx
    .select({ id: reports.id, folio: reports.folio, eventId: reports.eventId, lastStatusAt: reports.lastStatusAt })
    .from(reports)
    .where(eq(reports.clientReportId, p.reportId))
    .for("update")
    .limit(1);
  if (!report) {
    // Puede llegar antes que su reporte: el cliente debe reintentar después.
    throw new OperationError("REPORT_NOT_FOUND", "El reporte original aún no existe en el servidor", true);
  }
  const userId = await upsertUser(tx, p.device, now);
  const createdAt = new Date(p.createdAt);
  const [inserted] = await tx
    .insert(reportUpdates)
    .values({
      clientUpdateId: p.updateId,
      clientOperationId,
      reportId: report.id,
      userId,
      status: p.status,
      comment: p.comment || null,
      latitude: p.location?.latitude ?? null,
      longitude: p.location?.longitude ?? null,
      accuracyM: p.location?.accuracy ?? null,
      locationCapturedAt: p.location ? new Date(p.location.capturedAt) : null,
      createdAtClient: createdAt,
      timezoneOffsetMin: p.timezoneOffsetMinutes,
      connectivity: p.connectivity,
      receivedAt: now,
    })
    .$returningId();

  // El estado vigente es el de la actualización más reciente según la hora de captura,
  // aunque las operaciones lleguen desordenadas.
  if (createdAt.getTime() >= report.lastStatusAt.getTime()) {
    await tx.update(reports).set({ currentStatus: p.status, lastStatusAt: createdAt, updatedAt: now }).where(eq(reports.id, report.id));
  } else {
    await tx.update(reports).set({ updatedAt: now }).where(eq(reports.id, report.id));
  }

  await tx.insert(syncOperations).values({
    clientOperationId,
    type: "ADD_UPDATE",
    payloadHash: hash,
    userId,
    reportId: report.id,
    reportUpdateId: inserted.id,
    receivedAt: now,
  });
  return { reportId: p.reportId, serverId: report.id, folio: report.folio, eventId: report.eventId };
}

/**
 * Aplica una operación de forma idempotente. Reenviar la misma operación
 * (mismo clientOperationId) nunca crea un segundo registro: devuelve DUPLICATE
 * con los datos ya confirmados.
 */
export async function processOperation(db: Db, raw: unknown, now = new Date()): Promise<SyncResult> {
  const parsed = syncOperationSchema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "operación";
    return errorResult(extractOperationId(raw), "VALIDATION_ERROR", `Dato inválido: ${field}`, false);
  }
  const op = parsed.data;
  const hash = hashOperation(op);

  const already = await findAppliedResult(db, op.clientOperationId);
  if (already) return duplicateOrConflict(op.clientOperationId, already, hash);

  try {
    const report = await withDeadlockRetry(() =>
      db.transaction(async (tx) =>
        op.type === "CREATE_REPORT"
          ? applyCreate(tx, op.clientOperationId, op.payload, hash, now)
          : applyUpdate(tx, op.clientOperationId, op.payload, hash, now),
      ),
    );
    return { clientOperationId: op.clientOperationId, outcome: "APPLIED", report };
  } catch (err) {
    if (err instanceof OperationError) {
      if (err.code === "OPERATION_CONFLICT") {
        // Otra petición concurrente pudo confirmar ESTA misma operación entre la verificación y la transacción.
        const applied = await findAppliedResult(db, op.clientOperationId);
        if (applied) return duplicateOrConflict(op.clientOperationId, applied, hash);
      }
      return errorResult(op.clientOperationId, err.code, err.message, err.retriable);
    }
    if (isDuplicateKey(err)) {
      // Carrera: otra petición aplicó la misma operación al mismo tiempo.
      const applied = await findAppliedResult(db, op.clientOperationId);
      if (applied) return duplicateOrConflict(op.clientOperationId, applied, hash);
      return errorResult(op.clientOperationId, "OPERATION_CONFLICT", "Identificador ya utilizado por otro registro", false);
    }
    console.error("[sync] error aplicando operación", op.clientOperationId, err);
    return errorResult(op.clientOperationId, "INTERNAL_ERROR", "Error interno, reintentar más tarde", true);
  }
}

function duplicateOrConflict(
  clientOperationId: string,
  applied: { payloadHash: string; reportId: string; serverId: number; folio: string; eventId: number },
  hash: string,
): SyncResult {
  if (applied.payloadHash !== hash) {
    return errorResult(clientOperationId, "OPERATION_CONFLICT", "La operación ya existe con datos distintos", false);
  }
  return {
    clientOperationId,
    outcome: "DUPLICATE",
    report: { reportId: applied.reportId, serverId: applied.serverId, folio: applied.folio, eventId: applied.eventId },
  };
}

/** Procesa un lote en orden (las actualizaciones pueden depender de reportes del mismo lote). */
export async function processBatch(db: Db, operations: unknown[], now = new Date()): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const op of operations) results.push(await processOperation(db, op, now));
  return results;
}
