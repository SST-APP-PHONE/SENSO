import { LIMITS } from "../../shared/catalogs";
import type { SyncOperation, SyncResponse, SyncResult } from "../../shared/schemas";
import { publicApi } from "../api/client";
import type { IDBPTransaction } from "idb";
import { getDB, type SensoDB } from "../offline/db";
import { countOutbox, saveCatalog, setMeta, type OutboxCounts } from "../storage/reports";
import type { OutboxItem } from "../types/models";

export interface SyncState {
  /** navigator.onLine: el dispositivo cree tener red. */
  online: boolean;
  /**
   * El servidor respondió en el último intento. navigator.onLine puede ser true
   * sin salida real a internet (red caída, portal cautivo, antena sin enlace).
   */
  reachable: boolean;
  syncing: boolean;
  counts: OutboxCounts;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Se activa al recuperar la conexión para mostrar el aviso "Conexión restaurada". */
  justReconnected: boolean;
}

export interface SyncRunResult {
  skipped?: "offline" | "busy" | "unreachable";
  sent: number;
  synced: number;
  failed: number;
}

export interface SyncEngineDeps {
  sendBatch: (ops: SyncOperation[]) => Promise<SyncResponse>;
  fetchCatalog: () => Promise<void>;
  isOnline: () => boolean;
  now: () => number;
}

/** Espera exponencial: 5 s, 10 s, 20 s… hasta 10 min. */
export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
}

const defaultDeps: SyncEngineDeps = {
  sendBatch: (ops) => publicApi.sync(ops),
  fetchCatalog: async () => {
    const c = await publicApi.catalog();
    await saveCatalog(c.events);
  },
  isOnline: () => navigator.onLine,
  now: () => Date.now(),
};

/**
 * Motor de sincronización offline-first.
 *  - Lee la cola (outbox) de IndexedDB en orden FIFO.
 *  - Envía lotes; el servidor deduplica por clientOperationId.
 *  - Solo marca SYNCED (y elimina de la cola) lo que el servidor confirmó.
 *  - Fallos de red → FAILED con reintento automático (backoff) y manual.
 */
export class SyncEngine {
  private listeners = new Set<() => void>();
  private running: Promise<SyncRunResult> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private deps: SyncEngineDeps;
  state: SyncState;

  constructor(deps: Partial<SyncEngineDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
    this.state = {
      online: this.deps.isOnline(),
      reachable: true,
      syncing: false,
      counts: { operations: 0, reports: 0, failed: 0 },
      lastSyncAt: null,
      lastError: null,
      justReconnected: false,
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async refreshCounts() {
    this.set({ counts: await countOutbox() });
  }

  /** Arranque: recupera operaciones que quedaron "SYNCING" si la app se cerró a medio envío. */
  async start() {
    // Listeners primero (síncrono): un cambio de red durante el arranque no se pierde.
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisible);
    this.started = true;
    this.set({ online: this.deps.isOnline() });
    await recoverInterrupted();
    await this.refreshCounts();
    if (this.deps.isOnline()) await this.sync();
    else this.set({ online: false });
    this.schedule();
  }

  stop() {
    this.started = false;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.timer) clearTimeout(this.timer);
  }

  /** Reintento periódico: más frecuente si hay pendientes o el servidor no responde. */
  private schedule() {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const urgent = !this.state.reachable || this.state.counts.operations > 0;
    this.timer = setTimeout(async () => {
      await this.sync();
      this.schedule();
    }, !this.state.reachable ? 15_000 : urgent ? 30_000 : 120_000);
  }

  private onOnline = () => {
    this.set({ online: true, justReconnected: true });
    void this.sync({ force: true });
  };
  private onOffline = () => this.set({ online: false, reachable: false, justReconnected: false });
  private onVisible = () => {
    if (document.visibilityState === "visible") void this.sync();
  };

  private markReachable(reachable: boolean) {
    if (reachable === this.state.reachable) return;
    // Pasar de "sin servidor" a "con servidor" equivale a recuperar la conexión.
    this.set({ reachable, justReconnected: reachable ? true : false });
  }

  /** Conexión efectiva: red del dispositivo + servidor alcanzable. */
  isEffectivelyOnline() {
    return this.state.online && this.state.reachable;
  }

  dismissReconnected() {
    this.set({ justReconnected: false });
  }

  /**
   * Ejecuta una sincronización. `force` reintenta también los FAILED aunque no
   * se haya cumplido su espera (botón "Sincronizar ahora").
   */
  sync(opts: { force?: boolean } = {}): Promise<SyncRunResult> {
    if (this.running) return this.running;
    if (!this.deps.isOnline()) {
      this.set({ online: false });
      return Promise.resolve({ skipped: "offline", sent: 0, synced: 0, failed: 0 });
    }
    const run = async () => {
      this.set({ syncing: true, online: true });
      try {
        return await withCrossTabLock(() => this.runQueue(!!opts.force));
      } finally {
        this.running = null;
        await this.refreshCounts();
        this.set({ syncing: false });
        this.schedule();
      }
    };
    this.running = run();
    return this.running;
  }

  private async runQueue(force: boolean): Promise<SyncRunResult> {
    const total: SyncRunResult = { sent: 0, synced: 0, failed: 0 };
    // Verifica que el servidor responda (y actualiza el catálogo de eventos).
    // Si no responde, NO hay conexión real: la cola se queda intacta (PENDING).
    try {
      await this.deps.fetchCatalog();
      this.markReachable(true);
    } catch {
      this.markReachable(false);
      return { ...total, skipped: "unreachable" };
    }

    const attempted = new Set<string>();
    for (;;) {
      const batch = await selectBatch(this.deps.now(), force, attempted);
      if (!batch.length) break;
      batch.forEach((b) => attempted.add(b.clientOperationId));
      await markSyncing(batch);
      total.sent += batch.length;

      let response: SyncResponse;
      try {
        response = await this.deps.sendBatch(batch.map(toOperation));
        if (!response || !Array.isArray(response.results)) throw new Error("Respuesta inválida del servidor");
      } catch (err) {
        const message = err instanceof Error && err.name !== "AbortError" ? err.message : "Sin respuesta del servidor";
        await markFailed(batch, `No se pudo enviar: ${message}`, true, this.deps.now());
        total.failed += batch.length;
        this.set({ lastError: message });
        break;
      }

      const byId = new Map<string, SyncResult>();
      for (const r of response.results) if (r.clientOperationId) byId.set(r.clientOperationId, r);
      const outcome = await applyResults(batch, byId, this.deps.now());
      total.synced += outcome.synced;
      total.failed += outcome.failed;
      const syncedAt = new Date(this.deps.now()).toISOString();
      if (outcome.synced) await setMeta("lastSyncAt", syncedAt);
      this.set({ lastSyncAt: outcome.synced ? syncedAt : this.state.lastSyncAt, lastError: outcome.failed ? "Algunos registros no se sincronizaron" : null });
      await this.refreshCounts();
    }
    return total;
  }
}

function toOperation(item: OutboxItem): SyncOperation {
  return item.type === "CREATE_REPORT"
    ? { type: "CREATE_REPORT", clientOperationId: item.clientOperationId, payload: item.payload }
    : { type: "ADD_UPDATE", clientOperationId: item.clientOperationId, payload: item.payload };
}

/** Las operaciones en SYNCING al abrir la app quedaron interrumpidas: se reenvían (son idempotentes). */
export async function recoverInterrupted(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(["outbox", "reports", "updates"], "readwrite");
  const stuck = await tx.objectStore("outbox").index("by-status").getAll("SYNCING");
  for (const item of stuck) {
    await tx.objectStore("outbox").put({ ...item, status: "PENDING" });
    await setEntityStatus(tx, item, { syncStatus: "PENDING" });
  }
  await tx.done;
  return stuck.length;
}

/**
 * Elige el siguiente lote en orden FIFO. Una actualización solo se envía si su
 * reporte ya está confirmado o viaja antes en el mismo lote.
 */
async function selectBatch(now: number, force: boolean, attempted: Set<string>): Promise<OutboxItem[]> {
  const db = await getDB();
  const items = await db.getAllFromIndex("outbox", "by-seq");
  const reports = new Map((await db.getAll("reports")).map((r) => [r.id, r]));
  const batch: OutboxItem[] = [];
  const createsInBatch = new Set<string>();
  for (const item of items) {
    if (batch.length >= LIMITS.syncBatchMax) break;
    if (attempted.has(item.clientOperationId)) continue;
    if (item.status === "SYNCING") continue;
    if (item.status === "FAILED" && !force && (!item.retriable || item.nextAttemptAt > now)) continue;
    if (item.type === "ADD_UPDATE") {
      const parent = reports.get(item.reportId);
      const parentReady = parent?.syncStatus === "SYNCED" || createsInBatch.has(item.reportId);
      if (!parentReady) continue;
    } else {
      createsInBatch.add(item.reportId);
    }
    batch.push(item);
  }
  return batch;
}

type RWTx = IDBPTransaction<SensoDB, ("outbox" | "reports" | "updates")[], "readwrite">;

async function setEntityStatus(
  tx: RWTx,
  item: OutboxItem,
  patch: { syncStatus: OutboxItem["status"]; lastError?: string | null; syncedAt?: string | null; folio?: string; serverId?: number; eventId?: number },
) {
  if (item.type === "CREATE_REPORT") {
    const store = tx.objectStore("reports");
    const r = await store.get(item.reportId);
    if (!r) return;
    await store.put({
      ...r,
      syncStatus: patch.syncStatus,
      lastError: patch.lastError ?? (patch.syncStatus === "SYNCED" ? null : r.lastError),
      syncedAt: patch.syncedAt ?? r.syncedAt,
      folio: patch.folio ?? r.folio,
      serverId: patch.serverId ?? r.serverId,
      eventId: patch.eventId ?? r.eventId,
    });
  } else {
    const store = tx.objectStore("updates");
    const u = await store.get(item.payload.updateId);
    if (!u) return;
    await store.put({
      ...u,
      syncStatus: patch.syncStatus,
      lastError: patch.lastError ?? (patch.syncStatus === "SYNCED" ? null : u.lastError),
      syncedAt: patch.syncedAt ?? u.syncedAt,
    });
  }
}

async function markSyncing(batch: OutboxItem[]) {
  const db = await getDB();
  const tx = db.transaction(["outbox", "reports", "updates"], "readwrite");
  for (const item of batch) {
    await tx.objectStore("outbox").put({ ...item, status: "SYNCING" });
    await setEntityStatus(tx, item, { syncStatus: "SYNCING" });
  }
  await tx.done;
}

async function markFailed(batch: OutboxItem[], message: string, retriable: boolean, now: number) {
  const db = await getDB();
  const tx = db.transaction(["outbox", "reports", "updates"], "readwrite");
  for (const item of batch) {
    const current = await tx.objectStore("outbox").get(item.clientOperationId);
    if (!current) continue;
    const attempts = current.attempts + 1;
    await tx.objectStore("outbox").put({
      ...current,
      status: "FAILED",
      attempts,
      lastError: message,
      retriable,
      nextAttemptAt: now + backoffMs(attempts),
    });
    await setEntityStatus(tx, item, { syncStatus: "FAILED", lastError: message });
  }
  await tx.done;
}

async function applyResults(batch: OutboxItem[], byId: Map<string, SyncResult>, now: number) {
  let synced = 0;
  let failed = 0;
  const db = await getDB();
  const tx = db.transaction(["outbox", "reports", "updates"], "readwrite");
  for (const item of batch) {
    const r = byId.get(item.clientOperationId);
    const outbox = tx.objectStore("outbox");
    if (r && (r.outcome === "APPLIED" || r.outcome === "DUPLICATE")) {
      // Confirmado por el servidor: única condición para marcar SYNCED.
      await setEntityStatus(tx, item, {
        syncStatus: "SYNCED",
        syncedAt: new Date(now).toISOString(),
        folio: r.report.folio,
        serverId: r.report.serverId,
        eventId: r.report.eventId,
      });
      await outbox.delete(item.clientOperationId);
      synced++;
    } else {
      const current = (await outbox.get(item.clientOperationId)) ?? item;
      const attempts = current.attempts + 1;
      const message = r && r.outcome === "ERROR" ? r.error.message : "El servidor no confirmó esta operación";
      const retriable = r && r.outcome === "ERROR" ? r.error.retriable : true;
      await outbox.put({ ...current, status: "FAILED", attempts, lastError: message, retriable, nextAttemptAt: now + backoffMs(attempts) });
      await setEntityStatus(tx, item, { syncStatus: "FAILED", lastError: message });
      failed++;
    }
  }
  await tx.done;
  return { synced, failed };
}

/** Evita que dos pestañas sincronicen la misma cola a la vez (Web Locks API si existe). */
async function withCrossTabLock<T extends SyncRunResult>(fn: () => Promise<T>): Promise<T | SyncRunResult> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return fn();
  const result = await locks.request("senso-sync", { ifAvailable: true }, async (lock) => (lock ? fn() : null));
  return result ?? { skipped: "busy", sent: 0, synced: 0, failed: 0 };
}

export const syncEngine = new SyncEngine();
