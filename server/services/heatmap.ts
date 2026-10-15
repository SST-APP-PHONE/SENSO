import { and, count, desc, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { reports } from "../db/schema.js";
import { buildWhere, type Filters } from "./monitoring.js";

/**
 * Mapa de calor del centro de monitoreo (solo ADMIN).
 *
 * Privacidad: el servidor agrega los reportes en celdas de una cuadrícula y devuelve solo el
 * CENTRO de cada celda y su conteo; nunca coordenadas exactas en la capa de calor. El tamaño mínimo
 * de celda (~110 m) impide ubicar un domicilio a partir de la vista general. No se devuelven
 * comentarios, identificadores de dispositivo ni otros datos personales.
 */

/** Tamaños de celda permitidos, en grados (≈ 111 km por grado de latitud). */
export const CELL_SIZES = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1] as const;
/** Celdas máximas por eje en la elección automática (la cuadrícula resultante tiene a lo sumo ~80×80). */
const TARGET_CELLS_PER_AXIS = 80;
export const MAX_CELLS = 10_000;
export const MAX_POINTS = 2_000;
export const HOTSPOT_COUNT = 5;

export const heatmapOptionsSchema = z.object({
  cell: z.coerce
    .number()
    .refine((v) => (CELL_SIZES as readonly number[]).includes(v), "tamaño de celda no permitido")
    .optional(),
  includePoints: z
    .enum(["0", "1", "true", "false"])
    .transform((v) => v === "1" || v === "true")
    .optional(),
});
export type HeatmapOptions = z.infer<typeof heatmapOptionsSchema>;

/**
 * Coordenadas válidas: no nulas, dentro de rango y distintas de (0, 0), que es el valor típico de un
 * GPS sin fijar. Los reportes que no cumplen se cuentan en los totales pero no se dibujan.
 */
export const validLocation: SQL = sql`(${reports.latitude} IS NOT NULL AND ${reports.longitude} IS NOT NULL
  AND ${reports.latitude} BETWEEN -90 AND 90 AND ${reports.longitude} BETWEEN -180 AND 180
  AND NOT (${reports.latitude} = 0 AND ${reports.longitude} = 0))`;

/** Elige la celda más fina que mantiene la cuadrícula en un tamaño razonable para la extensión de los datos. */
export function autoCellSize(span: { latSpan: number; lngSpan: number } | null): number {
  if (!span) return CELL_SIZES[0];
  const needed = Math.max(span.latSpan, span.lngSpan) / TARGET_CELLS_PER_AXIS;
  return CELL_SIZES.find((s) => s >= needed) ?? CELL_SIZES[CELL_SIZES.length - 1];
}

const n = (v: unknown) => Number(v ?? 0);
/** Redondeo para que el centro de celda no arrastre ruido de coma flotante. */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export interface HeatCell {
  lat: number;
  lng: number;
  count: number;
}

export async function getHeatmap(db: Db, f: Filters, opts: HeatmapOptions = {}, now = new Date()) {
  const where = buildWhere(f, now);
  const located = and(where, validLocation);

  const [totals] = await db
    .select({
      total: count(),
      withLocation: sql<number>`SUM(CASE WHEN ${validLocation} THEN 1 ELSE 0 END)`,
      minLat: sql<number | null>`MIN(CASE WHEN ${validLocation} THEN ${reports.latitude} END)`,
      maxLat: sql<number | null>`MAX(CASE WHEN ${validLocation} THEN ${reports.latitude} END)`,
      minLng: sql<number | null>`MIN(CASE WHEN ${validLocation} THEN ${reports.longitude} END)`,
      maxLng: sql<number | null>`MAX(CASE WHEN ${validLocation} THEN ${reports.longitude} END)`,
    })
    .from(reports)
    .where(where);

  const total = n(totals?.total);
  const withLocation = n(totals?.withLocation);
  const span =
    withLocation > 0
      ? { latSpan: n(totals.maxLat) - n(totals.minLat), lngSpan: n(totals.maxLng) - n(totals.minLng) }
      : null;
  const cellSize = opts.cell ?? autoCellSize(span);

  // Agregación en el servidor: índice de celda = FLOOR(coordenada / tamaño).
  const gy = sql<number>`FLOOR(${reports.latitude} / ${cellSize})`;
  const gx = sql<number>`FLOOR(${reports.longitude} / ${cellSize})`;
  const cellRows = withLocation
    ? await db
        .select({ gy, gx, total: count() })
        .from(reports)
        .where(located)
        .groupBy(gy, gx)
        .orderBy(desc(count()), gy, gx)
        .limit(MAX_CELLS + 1)
    : [];

  const toCenter = (y: number, x: number) => ({ lat: round6((y + 0.5) * cellSize), lng: round6((x + 0.5) * cellSize) });
  const cells: HeatCell[] = cellRows.slice(0, MAX_CELLS).map((c) => ({ ...toCenter(n(c.gy), n(c.gx)), count: n(c.total) }));

  // Zonas de mayor concentración, con el municipio/zona más frecuente declarado en cada celda.
  const top = cellRows.slice(0, HOTSPOT_COUNT);
  const hotspots = await Promise.all(
    top.map(async (c) => {
      const [m] = await db
        .select({ municipality: reports.municipality, total: count() })
        .from(reports)
        .where(and(located, sql`${gy} = ${n(c.gy)}`, sql`${gx} = ${n(c.gx)}`, sql`${reports.municipality} IS NOT NULL AND ${reports.municipality} <> ''`))
        .groupBy(reports.municipality)
        .orderBy(desc(count()), reports.municipality)
        .limit(1);
      return { ...toCenter(n(c.gy), n(c.gx)), count: n(c.total), municipality: m?.municipality ?? null };
    }),
  );

  const byCategory = await db
    .select({ category: reports.category, total: count() })
    .from(reports)
    .where(where)
    .groupBy(reports.category)
    .orderBy(desc(count()), reports.category);
  const byStatus = await db
    .select({ status: reports.currentStatus, total: count() })
    .from(reports)
    .where(where)
    .groupBy(reports.currentStatus)
    .orderBy(desc(count()), reports.currentStatus);

  let points:
    | { id: number; folio: string; category: string; categoryGroup: string; status: string; severity: string; latitude: number; longitude: number; createdAtClient: Date }[]
    | undefined;
  let pointsTruncated = false;
  if (opts.includePoints && withLocation) {
    // Marcadores individuales: solo lo necesario para ubicar y abrir el reporte (sin comentario ni datos del dispositivo).
    const rows = await db
      .select({
        id: reports.id,
        folio: reports.folio,
        category: reports.category,
        categoryGroup: reports.categoryGroup,
        status: reports.currentStatus,
        severity: reports.severity,
        latitude: sql<number>`${reports.latitude}`,
        longitude: sql<number>`${reports.longitude}`,
        createdAtClient: reports.createdAtClient,
      })
      .from(reports)
      .where(located)
      .orderBy(desc(reports.createdAtClient), desc(reports.id))
      .limit(MAX_POINTS + 1);
    pointsTruncated = rows.length > MAX_POINTS;
    points = rows.slice(0, MAX_POINTS).map((r) => ({ ...r, latitude: n(r.latitude), longitude: n(r.longitude) }));
  }

  return {
    generatedAt: now.toISOString(),
    cellSizeDeg: cellSize,
    /** Tamaño aproximado del lado de la celda (en latitud). */
    cellSizeMeters: Math.round(cellSize * 111_320),
    totals: { reports: total, withLocation, withoutLocation: total - withLocation, cells: cells.length },
    cellsTruncated: cellRows.length > MAX_CELLS,
    cells,
    hotspots,
    byCategory: byCategory.map((r) => ({ category: r.category, total: n(r.total) })),
    byStatus: byStatus.map((r) => ({ status: r.status, total: n(r.total) })),
    ...(points ? { points, pointsTruncated } : {}),
  };
}

export type HeatmapResult = Awaited<ReturnType<typeof getHeatmap>>;
