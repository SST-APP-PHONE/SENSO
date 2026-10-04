import type { CategoryCode, Connectivity, ReportStatus, Severity } from "../../shared/catalogs";
import type { AddUpdatePayload, CreateReportPayload, GeoLocation, PublicEvent } from "../../shared/schemas";

/** Estado de sincronización de un registro local. */
export type SyncStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED";

export interface LocalReport {
  /** UUID generado en el dispositivo. */
  id: string;
  /** Clave de idempotencia de la operación de creación. */
  clientOperationId: string;
  /** Folio provisional legible (antes de sincronizar). */
  localFolio: string;
  /** Folio oficial asignado por el servidor (solo tras confirmación). */
  folio: string | null;
  serverId: number | null;
  eventId: number | null;
  eventName: string | null;
  category: CategoryCode;
  /** Estado al crear el reporte. */
  status: ReportStatus;
  /** Último estado conocido (incluye actualizaciones locales). */
  currentStatus: ReportStatus;
  severity: Severity;
  comment: string | null;
  municipality: string | null;
  location: GeoLocation | null;
  /** Fecha/hora UTC (ISO) de captura. */
  createdAt: string;
  timezoneOffsetMinutes: number;
  connectivity: Connectivity;
  deviceId: string;
  syncStatus: SyncStatus;
  lastError: string | null;
  syncedAt: string | null;
}

export interface LocalUpdate {
  id: string;
  clientOperationId: string;
  reportId: string;
  status: ReportStatus;
  comment: string | null;
  location: GeoLocation | null;
  createdAt: string;
  timezoneOffsetMinutes: number;
  connectivity: Connectivity;
  syncStatus: SyncStatus;
  lastError: string | null;
  syncedAt: string | null;
}

export type OutboxItem =
  | OutboxBase<"CREATE_REPORT", CreateReportPayload>
  | OutboxBase<"ADD_UPDATE", AddUpdatePayload>;

interface OutboxBase<T extends string, P> {
  clientOperationId: string;
  type: T;
  /** Orden de creación (monótono): la cola se procesa FIFO. */
  seq: number;
  reportId: string;
  /** Carga exacta que se envía siempre igual en cada reintento. */
  payload: P;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  /** false = error permanente (p. ej. validación): no se reintenta automáticamente. */
  retriable: boolean;
  nextAttemptAt: number;
  createdAt: string;
  syncedAt: string | null;
}

export interface CachedCatalog {
  events: PublicEvent[];
  fetchedAt: string;
}
