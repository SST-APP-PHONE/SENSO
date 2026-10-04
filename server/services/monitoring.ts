import { and, asc, count, desc, eq, gte, isNotNull, like, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { CATEGORY_CODES, CATEGORY_GROUPS, CONNECTIVITY, STATUSES } from "../../shared/catalogs.js";
import type { Db } from "../db/client.js";
import { events, reportUpdates, reports } from "../db/schema.js";
import { startOfDayInTimezone } from "../lib/time.js";

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/)
  .refine((s) => !Number.isNaN(Date.parse(s)), "fecha inválida");
const num = z.coerce.number().finite();

/** Filtros administrativos (todos opcionales). Se validan: nunca se interpolan en SQL. */
export const filtersSchema = z.object({
  eventId: z.coerce.number().int().positive().optional(),
  group: z.enum(CATEGORY_GROUPS).optional(),
  category: z.enum(CATEGORY_CODES).optional(),
  status: z.enum(STATUSES).optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
  /** Últimos N días (atajo de periodo). */
  days: z.coerce.number().int().min(1).max(3650).optional(),
  municipality: z.string().trim().min(1).max(120).optional(),
  connectivity: z.enum(CONNECTIVITY).optional(),
  minLat: num.gte(-90).lte(90).optional(),
  maxLat: num.gte(-90).lte(90).optional(),
  minLng: num.gte(-180).lte(180).optional(),
  maxLng: num.gte(-180).lte(180).optional(),
});
export type Filters = z.infer<typeof filtersSchema>;

/** "to" con solo fecha incluye el día completo. */
function endOf(to: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(Date.parse(to + "T23:59:59.999Z")) : new Date(to);
}

export function buildWhere(f: Filters, now = new Date()): SQL | undefined {
  const c: SQL[] = [];
  if (f.eventId) c.push(eq(reports.eventId, f.eventId));
  if (f.group) c.push(eq(reports.categoryGroup, f.group));
  if (f.category) c.push(eq(reports.category, f.category));
  if (f.status) c.push(eq(reports.currentStatus, f.status));
  if (f.from) c.push(gte(reports.createdAtClient, new Date(f.from)));
  if (f.to) c.push(lte(reports.createdAtClient, endOf(f.to)));
  if (f.days) c.push(gte(reports.createdAtClient, new Date(now.getTime() - f.days * 86_400_000)));
  if (f.municipality) c.push(like(reports.municipality, `%${f.municipality.replace(/[%_\\]/g, (m) => "\\" + m)}%`));
  if (f.connectivity) c.push(eq(reports.connectivity, f.connectivity));
  if (f.minLat !== undefined) c.push(gte(reports.latitude, f.minLat));
  if (f.maxLat !== undefined) c.push(lte(reports.latitude, f.maxLat));
  if (f.minLng !== undefined) c.push(gte(reports.longitude, f.minLng));
  if (f.maxLng !== undefined) c.push(lte(reports.longitude, f.maxLng));
  return c.length ? and(...c) : undefined;
}

const n = (v: unknown) => Number(v ?? 0);

export async function getSummary(db: Db, f: Filters, timezone: string, now = new Date()) {
  const where = buildWhere(f, now);
  const today = startOfDayInTimezone(now, timezone);
  const [k] = await db
    .select({
      total: count(),
      today: sql<number>`SUM(CASE WHEN ${reports.createdAtClient} >= ${today} THEN 1 ELSE 0 END)`,
      pending: sql<number>`SUM(CASE WHEN ${reports.currentStatus} <> 'AVAILABLE' THEN 1 ELSE 0 END)`,
      servicesAffected: sql<number>`SUM(CASE WHEN ${reports.categoryGroup} = 'SERVICE' AND ${reports.currentStatus} <> 'AVAILABLE' THEN 1 ELSE 0 END)`,
      restored: sql<number>`SUM(CASE WHEN ${reports.currentStatus} = 'AVAILABLE' AND ${reports.initialStatus} <> 'AVAILABLE' THEN 1 ELSE 0 END)`,
      withLocation: sql<number>`SUM(CASE WHEN ${reports.latitude} IS NOT NULL THEN 1 ELSE 0 END)`,
      offlineCaptured: sql<number>`SUM(CASE WHEN ${reports.connectivity} = 'OFFLINE' THEN 1 ELSE 0 END)`,
    })
    .from(reports)
    .where(where);

  const byCategory = await db
    .select({ category: reports.category, total: count() })
    .from(reports)
    .where(where)
    .groupBy(reports.category)
    .orderBy(desc(count()));
  const byStatus = await db
    .select({ status: reports.currentStatus, total: count() })
    .from(reports)
    .where(where)
    .groupBy(reports.currentStatus);

  return {
    kpis: {
      total: n(k?.total),
      today: n(k?.today),
      pending: n(k?.pending),
      servicesAffected: n(k?.servicesAffected),
      restored: n(k?.restored),
      withLocation: n(k?.withLocation),
      offlineCaptured: n(k?.offlineCaptured),
    },
    byCategory: byCategory.map((r) => ({ category: r.category, total: n(r.total) })),
    byStatus: byStatus.map((r) => ({ status: r.status, total: n(r.total) })),
    generatedAt: now.toISOString(),
  };
}

const listColumns = {
  id: reports.id,
  folio: reports.folio,
  eventId: reports.eventId,
  eventName: events.name,
  categoryGroup: reports.categoryGroup,
  category: reports.category,
  initialStatus: reports.initialStatus,
  currentStatus: reports.currentStatus,
  severity: reports.severity,
  comment: reports.comment,
  municipality: reports.municipality,
  latitude: reports.latitude,
  longitude: reports.longitude,
  accuracyM: reports.accuracyM,
  createdAtClient: reports.createdAtClient,
  timezoneOffsetMin: reports.timezoneOffsetMin,
  connectivity: reports.connectivity,
  receivedAt: reports.receivedAt,
  lastStatusAt: reports.lastStatusAt,
};

export async function listReports(db: Db, f: Filters, page: number, pageSize: number, now = new Date()) {
  const where = buildWhere(f, now);
  const [{ total }] = await db.select({ total: count() }).from(reports).where(where);
  const rows = await db
    .select(listColumns)
    .from(reports)
    .innerJoin(events, eq(events.id, reports.eventId))
    .where(where)
    .orderBy(desc(reports.createdAtClient), desc(reports.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { total: n(total), page, pageSize, rows };
}

export async function getReportDetail(db: Db, id: number) {
  const [report] = await db.select(listColumns).from(reports).innerJoin(events, eq(events.id, reports.eventId)).where(eq(reports.id, id)).limit(1);
  if (!report) return null;
  const history = await db
    .select({
      id: reportUpdates.id,
      status: reportUpdates.status,
      comment: reportUpdates.comment,
      latitude: reportUpdates.latitude,
      longitude: reportUpdates.longitude,
      accuracyM: reportUpdates.accuracyM,
      createdAtClient: reportUpdates.createdAtClient,
      connectivity: reportUpdates.connectivity,
      receivedAt: reportUpdates.receivedAt,
    })
    .from(reportUpdates)
    .where(eq(reportUpdates.reportId, id))
    .orderBy(asc(reportUpdates.createdAtClient), asc(reportUpdates.id));
  return { report, history };
}

export const MAP_POINT_LIMIT = 5000;

export async function getMapPoints(db: Db, f: Filters, now = new Date()) {
  const where = and(buildWhere(f, now), isNotNull(reports.latitude), isNotNull(reports.longitude));
  const rows = await db
    .select({
      id: reports.id,
      folio: reports.folio,
      category: reports.category,
      categoryGroup: reports.categoryGroup,
      status: reports.currentStatus,
      severity: reports.severity,
      latitude: reports.latitude,
      longitude: reports.longitude,
      accuracyM: reports.accuracyM,
      createdAtClient: reports.createdAtClient,
    })
    .from(reports)
    .where(where)
    .orderBy(desc(reports.createdAtClient))
    .limit(MAP_POINT_LIMIT + 1);
  return { truncated: rows.length > MAP_POINT_LIMIT, points: rows.slice(0, MAP_POINT_LIMIT) };
}

export async function listMunicipalities(db: Db) {
  const rows = await db
    .selectDistinct({ m: reports.municipality })
    .from(reports)
    .where(and(isNotNull(reports.municipality), ne(reports.municipality, "")))
    .orderBy(asc(reports.municipality))
    .limit(500);
  return rows.map((r) => r.m as string);
}

/** Exportación CSV en lotes (sin cargar todo en memoria). */
export async function* exportCsv(db: Db, f: Filters, now = new Date()): AsyncGenerator<string> {
  const header = [
    "folio",
    "evento",
    "grupo",
    "categoria",
    "estado_inicial",
    "estado_actual",
    "nivel",
    "comentario",
    "municipio",
    "latitud",
    "longitud",
    "precision_m",
    "capturado_utc",
    "offset_min",
    "conectividad",
    "recibido_utc",
  ];
  yield "﻿" + header.join(",") + "\r\n";
  const where = buildWhere(f, now);
  const batch = 1000;
  let lastId = Number.MAX_SAFE_INTEGER;
  for (;;) {
    const rows = await db
      .select(listColumns)
      .from(reports)
      .innerJoin(events, eq(events.id, reports.eventId))
      .where(and(where, sql`${reports.id} < ${lastId}`))
      .orderBy(desc(reports.id))
      .limit(batch);
    if (!rows.length) return;
    let chunk = "";
    for (const r of rows) {
      chunk +=
        [
          r.folio,
          r.eventName,
          r.categoryGroup,
          r.category,
          r.initialStatus,
          r.currentStatus,
          r.severity,
          r.comment,
          r.municipality,
          r.latitude,
          r.longitude,
          r.accuracyM,
          r.createdAtClient.toISOString(),
          r.timezoneOffsetMin,
          r.connectivity,
          r.receivedAt.toISOString(),
        ]
          .map(csvCell)
          .join(",") + "\r\n";
    }
    yield chunk;
    lastId = rows[rows.length - 1].id;
    if (rows.length < batch) return;
  }
}

/** Escapa una celda CSV y neutraliza inyección de fórmulas (=, +, -, @). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
