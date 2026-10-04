import type { NextFunction, Request, Response } from "express";

/** Manejo seguro de errores: nunca se exponen trazas ni detalles internos al cliente. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as { status?: number; statusCode?: number; type?: string };
  const status = e?.status ?? e?.statusCode ?? 500;
  if (e?.type === "entity.too.large") return res.status(413).json({ error: "Solicitud demasiado grande" });
  if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" });
  if (status >= 500) console.error("[api] error", err);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: status >= 500 ? "Error interno" : "Solicitud inválida" });
}
