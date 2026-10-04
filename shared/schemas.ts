import { z } from "zod";
import { CATEGORY_CODES, CONNECTIVITY, LIMITS, SEVERITIES, STATUSES } from "./catalogs.js";

/**
 * Contrato de sincronización cliente → servidor.
 * El servidor NO confía en el cliente: todo se valida aquí antes de persistir.
 */

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

/** Elimina caracteres de control y recorta espacios. */
export const cleanText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(max));

export const locationSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracy: z.number().gte(0).lte(1_000_000).nullable(),
  capturedAt: isoDate,
});
export type GeoLocation = z.infer<typeof locationSchema>;

export const deviceSchema = z.object({
  deviceId: uuid,
  platform: cleanText(60).optional(),
});

export const createReportPayloadSchema = z.object({
  reportId: uuid,
  localFolio: cleanText(40),
  eventId: z.number().int().positive().nullable(),
  category: z.enum(CATEGORY_CODES),
  status: z.enum(STATUSES),
  severity: z.enum(SEVERITIES),
  comment: cleanText(LIMITS.commentMax).nullable(),
  municipality: cleanText(LIMITS.municipalityMax).nullable(),
  location: locationSchema.nullable(),
  createdAt: isoDate,
  timezoneOffsetMinutes: z.number().int().gte(-840).lte(840),
  connectivity: z.enum(CONNECTIVITY),
  device: deviceSchema,
});
export type CreateReportPayload = z.infer<typeof createReportPayloadSchema>;

export const addUpdatePayloadSchema = z.object({
  updateId: uuid,
  reportId: uuid,
  status: z.enum(STATUSES),
  comment: cleanText(LIMITS.commentMax).nullable(),
  location: locationSchema.nullable(),
  createdAt: isoDate,
  timezoneOffsetMinutes: z.number().int().gte(-840).lte(840),
  connectivity: z.enum(CONNECTIVITY),
  device: deviceSchema,
});
export type AddUpdatePayload = z.infer<typeof addUpdatePayloadSchema>;

export const syncOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_REPORT"), clientOperationId: uuid, payload: createReportPayloadSchema }),
  z.object({ type: z.literal("ADD_UPDATE"), clientOperationId: uuid, payload: addUpdatePayloadSchema }),
]);
export type SyncOperation = z.infer<typeof syncOperationSchema>;

/** Validación del lote: la de cada operación se hace por separado para no rechazar el lote entero. */
export const syncRequestSchema = z.object({
  operations: z.array(z.unknown()).min(1).max(LIMITS.syncBatchMax),
});

export type SyncErrorCode =
  | "VALIDATION_ERROR"
  | "REPORT_NOT_FOUND"
  | "OPERATION_CONFLICT"
  | "INTERNAL_ERROR";

export interface SyncResultApplied {
  clientOperationId: string;
  outcome: "APPLIED" | "DUPLICATE";
  /** Datos confirmados por el servidor. */
  report: { reportId: string; serverId: number; folio: string; eventId: number };
}
export interface SyncResultError {
  clientOperationId: string | null;
  outcome: "ERROR";
  error: { code: SyncErrorCode; message: string; retriable: boolean };
}
export type SyncResult = SyncResultApplied | SyncResultError;

export interface SyncResponse {
  results: SyncResult[];
  serverTime: string;
}

export interface PublicEvent {
  id: number;
  type: string;
  name: string;
  isActive: boolean;
  startedAt: string;
}

export interface CatalogResponse {
  events: PublicEvent[];
  serverTime: string;
}
