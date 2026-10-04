import type { CatalogResponse, SyncOperation, SyncResponse } from "../../shared/schemas";

/** Base de la API relativa al lugar donde se publica la app (p. ej. /senso/api). */
export const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetchImpl(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Senso-Request": "1", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* sin cuerpo JSON */
      }
      throw new HttpError(res.status, msg);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const publicApi = {
  sync: (operations: SyncOperation[], fetchImpl?: typeof fetch) =>
    request<SyncResponse>("/sync", { method: "POST", body: JSON.stringify({ operations }), timeoutMs: 30_000 }, fetchImpl),
  catalog: (fetchImpl?: typeof fetch) => request<CatalogResponse>("/catalog", {}, fetchImpl),
};

export const adminApi = {
  get: <T>(path: string) => request<T>(`/admin${path}`),
  post: <T>(path: string, body: unknown) => request<T>(`/admin${path}`, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(`/admin${path}`, { method: "PATCH", body: JSON.stringify(body) }),
};
