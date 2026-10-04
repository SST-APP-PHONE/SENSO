import type { CategoryCode, ReportStatus, Severity } from "../../shared/catalogs";
import type { AddUpdatePayload, CreateReportPayload, GeoLocation, PublicEvent } from "../../shared/schemas";
import { getDB, type MetaRecord } from "../offline/db";
import type { CachedCatalog, LocalReport, LocalUpdate, OutboxItem, SyncStatus } from "../types/models";
import { describePlatform } from "../utils/format";
import { localFolio, uuid } from "../utils/ids";

type MetaKey = MetaRecord["key"];
type MetaValue<K extends MetaKey> = Extract<MetaRecord, { key: K }>["value"];

export async function getMeta<K extends MetaKey>(key: K): Promise<MetaValue<K> | undefined> {
  const db = await getDB();
  const rec = await db.get("meta", key);
  return rec?.value as MetaValue<K> | undefined;
}

export async function setMeta<K extends MetaKey>(key: K, value: MetaValue<K>): Promise<void> {
  const db = await getDB();
  await db.put("meta", { key, value } as MetaRecord);
}

/** Identificador anónimo del dispositivo (no contiene datos personales). */
export async function getDeviceId(): Promise<string> {
  const db = await getDB();
  const tx = db.transaction("meta", "readwrite");
  const rec = await tx.store.get("deviceId");
  if (rec) {
    await tx.done;
    return rec.value as string;
  }
  const id = uuid();
  await tx.store.put({ key: "deviceId", value: id });
  await tx.done;
  return id;
}

export async function getCachedCatalog(): Promise<CachedCatalog | undefined> {
  return getMeta("catalog");
}

export async function saveCatalog(events: PublicEvent[]): Promise<void> {
  await setMeta("catalog", { events, fetchedAt: new Date().toISOString() });
}

export interface NewReportInput {
  category: CategoryCode;
  status: ReportStatus;
  severity: Severity;
  comment?: string | null;
  municipality?: string | null;
  location: GeoLocation | null;
  event: { id: number; name: string } | null;
  online: boolean;
  now?: Date;
}

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t.length ? t : null;
};

/**
 * Guarda el reporte y su operación de sincronización en UNA transacción de IndexedDB:
 * o se guardan ambos, o ninguno. No hace ninguna llamada de red.
 */
export async function createReport(input: NewReportInput): Promise<LocalReport> {
  const deviceId = await getDeviceId();
  const now = input.now ?? new Date();
  const report: LocalReport = {
    id: uuid(),
    clientOperationId: uuid(),
    localFolio: localFolio(now),
    folio: null,
    serverId: null,
    eventId: input.event?.id ?? null,
    eventName: input.event?.name ?? null,
    category: input.category,
    status: input.status,
    currentStatus: input.status,
    severity: input.severity,
    comment: clean(input.comment),
    municipality: clean(input.municipality),
    location: input.location,
    createdAt: now.toISOString(),
    timezoneOffsetMinutes: -now.getTimezoneOffset(),
    connectivity: input.online ? "ONLINE" : "OFFLINE",
    deviceId,
    syncStatus: "PENDING",
    lastError: null,
    syncedAt: null,
  };
  const payload: CreateReportPayload = {
    reportId: report.id,
    localFolio: report.localFolio,
    eventId: report.eventId,
    category: report.category,
    status: report.status,
    severity: report.severity,
    comment: report.comment,
    municipality: report.municipality,
    location: report.location,
    createdAt: report.createdAt,
    timezoneOffsetMinutes: report.timezoneOffsetMinutes,
    connectivity: report.connectivity,
    device: { deviceId, platform: describePlatform() },
  };

  const db = await getDB();
  const tx = db.transaction(["reports", "outbox", "meta"], "readwrite");
  const seq = await nextSeq(tx.objectStore("meta"));
  await tx.objectStore("reports").add(report);
  await tx.objectStore("outbox").add({
    clientOperationId: report.clientOperationId,
    type: "CREATE_REPORT",
    seq,
    reportId: report.id,
    payload,
    status: "PENDING",
    attempts: 0,
    lastError: null,
    retriable: true,
    nextAttemptAt: 0,
    createdAt: report.createdAt,
    syncedAt: null,
  });
  await tx.done;
  return report;
}

export interface NewUpdateInput {
  reportId: string;
  status: ReportStatus;
  comment?: string | null;
  location: GeoLocation | null;
  online: boolean;
  now?: Date;
}

/** Registra un cambio de estado (restablecimiento) en el historial, también sin conexión. */
export async function addReportUpdate(input: NewUpdateInput): Promise<LocalUpdate> {
  const deviceId = await getDeviceId();
  const now = input.now ?? new Date();
  const update: LocalUpdate = {
    id: uuid(),
    clientOperationId: uuid(),
    reportId: input.reportId,
    status: input.status,
    comment: clean(input.comment),
    location: input.location,
    createdAt: now.toISOString(),
    timezoneOffsetMinutes: -now.getTimezoneOffset(),
    connectivity: input.online ? "ONLINE" : "OFFLINE",
    syncStatus: "PENDING",
    lastError: null,
    syncedAt: null,
  };
  const payload: AddUpdatePayload = {
    updateId: update.id,
    reportId: update.reportId,
    status: update.status,
    comment: update.comment,
    location: update.location,
    createdAt: update.createdAt,
    timezoneOffsetMinutes: update.timezoneOffsetMinutes,
    connectivity: update.connectivity,
    device: { deviceId, platform: describePlatform() },
  };

  const db = await getDB();
  const tx = db.transaction(["reports", "updates", "outbox", "meta"], "readwrite");
  const reports = tx.objectStore("reports");
  const report = await reports.get(input.reportId);
  if (!report) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error("Reporte no encontrado en este dispositivo");
  }
  const seq = await nextSeq(tx.objectStore("meta"));
  await tx.objectStore("updates").add(update);
  if (update.createdAt >= latestStatusAt(report, await tx.objectStore("updates").index("by-report").getAll(report.id))) {
    await reports.put({ ...report, currentStatus: update.status });
  }
  await tx.objectStore("outbox").add({
    clientOperationId: update.clientOperationId,
    type: "ADD_UPDATE",
    seq,
    reportId: report.id,
    payload,
    status: "PENDING",
    attempts: 0,
    lastError: null,
    retriable: true,
    nextAttemptAt: 0,
    createdAt: update.createdAt,
    syncedAt: null,
  });
  await tx.done;
  return update;
}

function latestStatusAt(report: LocalReport, updates: LocalUpdate[]): string {
  return updates.reduce((max, u) => (u.createdAt > max ? u.createdAt : max), report.createdAt);
}

async function nextSeq(meta: { get(k: string): Promise<MetaRecord | undefined>; put(v: MetaRecord): Promise<unknown> }): Promise<number> {
  const rec = await meta.get("opSeq");
  const next = ((rec?.value as number | undefined) ?? 0) + 1;
  await meta.put({ key: "opSeq", value: next });
  return next;
}

/** Estado de sincronización combinado del reporte y sus actualizaciones. */
export function combinedSyncStatus(report: LocalReport, updates: LocalUpdate[]): SyncStatus {
  const all = [report.syncStatus, ...updates.map((u) => u.syncStatus)];
  if (all.includes("FAILED")) return "FAILED";
  if (all.includes("SYNCING")) return "SYNCING";
  if (all.includes("PENDING")) return "PENDING";
  return "SYNCED";
}

export interface ReportWithHistory {
  report: LocalReport;
  updates: LocalUpdate[];
  syncStatus: SyncStatus;
}

export async function listReports(): Promise<ReportWithHistory[]> {
  const db = await getDB();
  const tx = db.transaction(["reports", "updates"], "readonly");
  const reports = await tx.objectStore("reports").index("by-created").getAll();
  const updates = await tx.objectStore("updates").getAll();
  await tx.done;
  const byReport = new Map<string, LocalUpdate[]>();
  for (const u of updates) byReport.set(u.reportId, [...(byReport.get(u.reportId) ?? []), u]);
  return reports
    .reverse()
    .map((report) => {
      const ups = (byReport.get(report.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { report, updates: ups, syncStatus: combinedSyncStatus(report, ups) };
    });
}

export async function getReport(id: string): Promise<ReportWithHistory | null> {
  const db = await getDB();
  const report = await db.get("reports", id);
  if (!report) return null;
  const updates = (await db.getAllFromIndex("updates", "by-report", id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { report, updates, syncStatus: combinedSyncStatus(report, updates) };
}

export interface OutboxCounts {
  /** Operaciones aún no confirmadas por el servidor. */
  operations: number;
  /** Reportes distintos con algo pendiente de sincronizar. */
  reports: number;
  failed: number;
}

/** La cola solo contiene operaciones no confirmadas: al confirmarse se eliminan. */
export async function countOutbox(): Promise<OutboxCounts> {
  const db = await getDB();
  const items = await db.getAll("outbox");
  return {
    operations: items.length,
    reports: new Set(items.map((i) => i.reportId)).size,
    failed: items.filter((i) => i.status === "FAILED").length,
  };
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const db = await getDB();
  return db.getAllFromIndex("outbox", "by-seq");
}
