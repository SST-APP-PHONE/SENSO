import {
  bigint,
  boolean,
  char,
  datetime,
  double,
  index,
  int,
  json,
  mysqlTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Esquema SENSO (MySQL). Todas las fechas se guardan en UTC (DATETIME(3)).
 */

const id = () => bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement();
const fk = (name: string) => bigint(name, { mode: "number", unsigned: true });
const ts = (name: string) => datetime(name, { mode: "date", fsp: 3 });

/** Eventos / emergencias (huracán, sismo, …). Cada reporte pertenece a uno. */
export const events = mysqlTable(
  "events",
  {
    id: id(),
    type: varchar("type", { length: 20 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    /** Evento "Emergencia general" al que se asignan reportes sin evento válido. */
    isDefault: boolean("is_default").notNull().default(false),
    /** Clave única de eventos del sistema ("GENERAL"); NULL para eventos creados por administradores. */
    systemKey: varchar("system_key", { length: 20 }),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
    createdByAdminId: fk("created_by_admin_id"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("events_active_idx").on(t.isActive), index("events_default_idx").on(t.isDefault), uniqueIndex("events_system_key_uq").on(t.systemKey)],
);

/**
 * Personas que reportan, identificadas solo por un identificador anónimo de
 * dispositivo generado en el propio dispositivo. Sin nombre, correo ni teléfono.
 */
export const users = mysqlTable(
  "users",
  {
    id: id(),
    deviceId: char("device_id", { length: 36 }).notNull(),
    platform: varchar("platform", { length: 60 }),
    firstSeenAt: ts("first_seen_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull(),
  },
  (t) => [uniqueIndex("users_device_uq").on(t.deviceId)],
);

export const reports = mysqlTable(
  "reports",
  {
    id: id(),
    /** UUID generado en el dispositivo (identidad estable offline/online). */
    clientReportId: char("client_report_id", { length: 36 }).notNull(),
    /** Clave de idempotencia de la operación que creó el reporte. */
    clientOperationId: char("client_operation_id", { length: 36 }).notNull(),
    /** Folio oficial asignado por el servidor: SENSO-AAAA-000001. */
    folio: varchar("folio", { length: 32 }).notNull(),
    /** Folio provisional que vio la persona antes de sincronizar. */
    localFolio: varchar("local_folio", { length: 40 }).notNull(),
    eventId: fk("event_id").notNull().references(() => events.id),
    userId: fk("user_id").notNull().references(() => users.id),
    categoryGroup: varchar("category_group", { length: 10 }).notNull(),
    category: varchar("category", { length: 30 }).notNull(),
    initialStatus: varchar("initial_status", { length: 15 }).notNull(),
    currentStatus: varchar("current_status", { length: 15 }).notNull(),
    severity: varchar("severity", { length: 10 }).notNull(),
    comment: text("comment"),
    municipality: varchar("municipality", { length: 120 }),
    latitude: double("latitude"),
    longitude: double("longitude"),
    accuracyM: double("accuracy_m"),
    locationCapturedAt: ts("location_captured_at"),
    /** Fecha/hora de captura en el dispositivo (UTC). */
    createdAtClient: ts("created_at_client").notNull(),
    timezoneOffsetMin: smallint("timezone_offset_min").notNull(),
    /** Conectividad del dispositivo al momento de capturar (ONLINE/OFFLINE). */
    connectivity: varchar("connectivity", { length: 10 }).notNull(),
    receivedAt: ts("received_at").notNull(),
    lastStatusAt: ts("last_status_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("reports_client_report_uq").on(t.clientReportId),
    uniqueIndex("reports_client_op_uq").on(t.clientOperationId),
    uniqueIndex("reports_folio_uq").on(t.folio),
    index("reports_created_idx").on(t.createdAtClient),
    index("reports_event_idx").on(t.eventId, t.createdAtClient),
    index("reports_category_idx").on(t.category),
    index("reports_status_idx").on(t.currentStatus),
    index("reports_lat_lng_idx").on(t.latitude, t.longitude),
    index("reports_municipality_idx").on(t.municipality),
    index("reports_user_idx").on(t.userId),
  ],
);

/** Historial de estado de cada reporte (restablecimiento, intermitencias…). */
export const reportUpdates = mysqlTable(
  "report_updates",
  {
    id: id(),
    clientUpdateId: char("client_update_id", { length: 36 }).notNull(),
    clientOperationId: char("client_operation_id", { length: 36 }).notNull(),
    reportId: fk("report_id").notNull().references(() => reports.id),
    userId: fk("user_id").notNull().references(() => users.id),
    status: varchar("status", { length: 15 }).notNull(),
    comment: text("comment"),
    latitude: double("latitude"),
    longitude: double("longitude"),
    accuracyM: double("accuracy_m"),
    locationCapturedAt: ts("location_captured_at"),
    createdAtClient: ts("created_at_client").notNull(),
    timezoneOffsetMin: smallint("timezone_offset_min").notNull(),
    connectivity: varchar("connectivity", { length: 10 }).notNull(),
    receivedAt: ts("received_at").notNull(),
  },
  (t) => [
    uniqueIndex("updates_client_update_uq").on(t.clientUpdateId),
    uniqueIndex("updates_client_op_uq").on(t.clientOperationId),
    index("updates_report_idx").on(t.reportId, t.createdAtClient),
    index("updates_status_idx").on(t.status),
  ],
);

/** Registro de idempotencia: una fila por clientOperationId aplicado. */
export const syncOperations = mysqlTable(
  "sync_operations",
  {
    id: id(),
    clientOperationId: char("client_operation_id", { length: 36 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    userId: fk("user_id").notNull(),
    reportId: fk("report_id").notNull(),
    reportUpdateId: fk("report_update_id"),
    receivedAt: ts("received_at").notNull(),
  },
  (t) => [uniqueIndex("sync_ops_client_op_uq").on(t.clientOperationId), index("sync_ops_received_idx").on(t.receivedAt)],
);

/** Consecutivo de folios por año. */
export const folioCounters = mysqlTable("folio_counters", {
  year: smallint("year").primaryKey(),
  lastValue: int("last_value", { unsigned: true }).notNull(),
});

export const adminUsers = mysqlTable(
  "admin_users",
  {
    id: id(),
    email: varchar("email", { length: 190 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    /** ADMIN: gestiona eventos y exporta. VIEWER: solo consulta. */
    role: varchar("role", { length: 10 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    failedAttempts: int("failed_attempts", { unsigned: true }).notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    /** Se incrementa para invalidar sesiones emitidas (cambio de contraseña / desactivación). */
    sessionVersion: int("session_version", { unsigned: true }).notNull().default(1),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("admin_users_email_uq").on(t.email)],
);

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: id(),
    adminUserId: fk("admin_user_id"),
    action: varchar("action", { length: 60 }).notNull(),
    entity: varchar("entity", { length: 40 }),
    entityId: varchar("entity_id", { length: 64 }),
    details: json("details"),
    /** IP truncada (/24 IPv4, /48 IPv6): nunca la IP completa. */
    ipPrefix: varchar("ip_prefix", { length: 64 }),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_admin_idx").on(t.adminUserId)],
);
