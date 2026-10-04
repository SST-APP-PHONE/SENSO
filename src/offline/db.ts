import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CachedCatalog, LocalReport, LocalUpdate, OutboxItem } from "../types/models";

/**
 * Base de datos local (IndexedDB). Es la fuente de verdad en el dispositivo:
 * los reportes se escriben aquí ANTES de cualquier intento de red.
 */
export interface SensoDB extends DBSchema {
  reports: { key: string; value: LocalReport; indexes: { "by-created": string } };
  updates: { key: string; value: LocalUpdate; indexes: { "by-report": string } };
  outbox: { key: string; value: OutboxItem; indexes: { "by-seq": number; "by-status": string; "by-report": string } };
  meta: { key: string; value: MetaRecord };
}

export type MetaRecord =
  | { key: "deviceId"; value: string }
  | { key: "opSeq"; value: number }
  | { key: "catalog"; value: CachedCatalog }
  | { key: "privacyAccepted"; value: string }
  | { key: "selectedEventId"; value: number | null }
  | { key: "lastSyncAt"; value: string };

export const DB_NAME = "senso";
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SensoDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<SensoDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SensoDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const reports = db.createObjectStore("reports", { keyPath: "id" });
          reports.createIndex("by-created", "createdAt");
          const updates = db.createObjectStore("updates", { keyPath: "id" });
          updates.createIndex("by-report", "reportId");
          const outbox = db.createObjectStore("outbox", { keyPath: "clientOperationId" });
          outbox.createIndex("by-seq", "seq");
          outbox.createIndex("by-status", "status");
          outbox.createIndex("by-report", "reportId");
          db.createObjectStore("meta", { keyPath: "key" });
        }
        // Futuras versiones: store "evidence" (fotografías) con blobs comprimidos
        // y operación de cola "UPLOAD_EVIDENCE". No implementado en el MVP.
      },
      blocking() {
        // Otra pestaña necesita actualizar el esquema: liberar la conexión.
        void dbPromise?.then((d) => d.close());
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/** Solo para pruebas: cierra y olvida la conexión (simula cerrar la app). */
export async function closeDBForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

/** Pide al navegador almacenamiento persistente para que no borre la cola bajo presión de espacio. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
