import type { SyncOperation, SyncResponse, SyncResult } from "../../shared/schemas";

/**
 * Servidor simulado con la MISMA semántica de idempotencia que el real
 * (el real se prueba contra MySQL en tests/server).
 */
export class FakeServer {
  reports = new Map<string, { folio: string; serverId: number; status: string; updates: string[] }>();
  applied = new Map<string, SyncResult>();
  requests: SyncOperation[][] = [];
  private seq = 0;
  /** Falla de red antes de llegar al servidor. */
  failNext = 0;
  /** El servidor aplica, pero la respuesta se pierde (caso clásico de duplicados). */
  loseResponseNext = 0;
  rejectOps = new Set<string>();

  sendBatch = async (ops: SyncOperation[]): Promise<SyncResponse> => {
    this.requests.push(ops);
    if (this.failNext > 0) {
      this.failNext--;
      throw new TypeError("Failed to fetch");
    }
    const results = ops.map((op) => this.apply(op));
    if (this.loseResponseNext > 0) {
      this.loseResponseNext--;
      throw new TypeError("Network connection lost");
    }
    return { results, serverTime: new Date().toISOString() };
  };

  private apply(op: SyncOperation): SyncResult {
    if (this.rejectOps.has(op.clientOperationId)) {
      return { clientOperationId: op.clientOperationId, outcome: "ERROR", error: { code: "VALIDATION_ERROR", message: "Dato inválido", retriable: false } };
    }
    const prev = this.applied.get(op.clientOperationId);
    if (prev && prev.outcome !== "ERROR") return { ...prev, outcome: "DUPLICATE" };
    if (op.type === "CREATE_REPORT") {
      const serverId = ++this.seq;
      const folio = `SENSO-2026-${String(serverId).padStart(6, "0")}`;
      this.reports.set(op.payload.reportId, { folio, serverId, status: op.payload.status, updates: [] });
      const r: SyncResult = { clientOperationId: op.clientOperationId, outcome: "APPLIED", report: { reportId: op.payload.reportId, serverId, folio, eventId: 1 } };
      this.applied.set(op.clientOperationId, r);
      return r;
    }
    const rep = this.reports.get(op.payload.reportId);
    if (!rep) return { clientOperationId: op.clientOperationId, outcome: "ERROR", error: { code: "REPORT_NOT_FOUND", message: "no existe", retriable: true } };
    rep.updates.push(op.payload.status);
    rep.status = op.payload.status;
    const r: SyncResult = { clientOperationId: op.clientOperationId, outcome: "APPLIED", report: { reportId: op.payload.reportId, serverId: rep.serverId, folio: rep.folio, eventId: 1 } };
    this.applied.set(op.clientOperationId, r);
    return r;
  }
}
