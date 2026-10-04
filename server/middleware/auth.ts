import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { adminUsers } from "../db/schema.js";
import { SESSION_COOKIE, verifySession } from "../lib/session.js";

export interface AdminContext {
  id: number;
  email: string;
  name: string;
  role: "ADMIN" | "VIEWER";
}

declare module "express-serve-static-core" {
  interface Request {
    admin?: AdminContext;
  }
}

/** Exige sesión administrativa válida y vigente (verificada contra la BD en cada petición). */
export function requireAdmin(db: Db, secret: string, role: "ADMIN" | "VIEWER" = "VIEWER") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const claims = verifySession(req.cookies?.[SESSION_COOKIE], secret);
    if (!claims) return res.status(401).json({ error: "No autenticado" });
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, claims.sub)).limit(1);
    if (!user || !user.isActive || user.sessionVersion !== claims.ver) {
      return res.status(401).json({ error: "Sesión no válida" });
    }
    const userRole = user.role === "ADMIN" ? "ADMIN" : "VIEWER";
    if (role === "ADMIN" && userRole !== "ADMIN") return res.status(403).json({ error: "Permisos insuficientes" });
    req.admin = { id: user.id, email: user.email, name: user.name, role: userRole };
    next();
  };
}

/** Defensa CSRF para endpoints con cookie: exige cabecera personalizada (no enviable cross-site sin CORS). */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.get("x-senso-request") !== "1") return res.status(403).json({ error: "Solicitud no permitida" });
  next();
}
