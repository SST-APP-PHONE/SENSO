import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Db } from "./db/client.js";
import type { ServerConfig } from "./lib/config.js";
import { requireCsrfHeader } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errors.js";
import { adminRouter } from "./routes/admin.js";
import { healthRouter, publicRouter } from "./routes/public.js";

export interface AppOptions {
  /** null si DATABASE_URL falta o es inválida: la API arranca igual y /health lo informa. */
  db: Db | null;
  config: ServerConfig;
  /** Carpeta con el build del frontend (se sirve bajo /senso). Opcional. */
  staticDir?: string;
}

/** Prefijos bajo los que responde la API: raíz (Vercel /api) y /senso/api (publicación final). */
const API_PREFIXES = ["/api", "/senso/api"];

export function createApp({ db, config, staticDir }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  // Detrás del proxy de Vercel / balanceador: usar la IP del primer salto.
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (config.corsOrigins.length) {
    app.use((req, res, next) => {
      const origin = req.get("origin");
      if (origin && config.corsOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Senso-Request");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      }
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });
  }

  const limiter = (windowMs: number, limit: number) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: () => config.disableRateLimit,
      message: { error: "Demasiadas solicitudes. Intenta de nuevo en un momento." },
    });

  const syncLimiter = limiter(60_000, 60);
  const readLimiter = limiter(60_000, 300);
  const loginLimiter = limiter(15 * 60_000, 20);

  for (const prefix of API_PREFIXES) {
    const api = express.Router();
    api.use(express.json({ limit: "256kb" }));
    api.use(cookieParser());
    api.use((_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex");
      next();
    });
    api.use("/sync", syncLimiter);
    api.use(readLimiter);
    api.use(healthRouter(db, config));
    if (db) {
      api.use(publicRouter(db));
      if (config.adminConfigured) api.use("/admin", requireCsrfHeader, adminRouter(db, config, loginLimiter));
      else api.use("/admin", (_req, res) => res.status(503).json({ error: "Centro de monitoreo no configurado (ADMIN_SECRET)" }));
    } else {
      api.use((req, res, next) =>
        req.path === "/health" ? next() : res.status(503).json({ error: "Servicio no disponible: base de datos no configurada" }),
      );
    }
    api.use((_req, res) => res.status(404).json({ error: "No encontrado" }));
    app.use(prefix, api);
  }

  if (staticDir && existsSync(staticDir)) {
    // Archivos del build (con hash) y SPA fallback bajo /senso.
    app.use(
      "/senso",
      express.static(staticDir, {
        index: false,
        setHeaders(res, filePath) {
          if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          else res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
    app.get(/^\/senso(\/.*)?$/, (req, res) => {
      if (req.path.startsWith("/senso/admin")) res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(staticDir, "index.html"));
    });
    app.get("/", (_req, res) => res.redirect(302, "/senso/"));
  }

  app.use(errorHandler);
  return app;
}
