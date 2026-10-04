import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/app.js";
import { resolveDb } from "../server/db/client.js";
import { loadConfig } from "../server/lib/config.js";

/**
 * Función serverless de Vercel. vercel.json reescribe /senso/api/* y /api/* hacia aquí;
 * los archivos estáticos los sirve la CDN de Vercel desde dist/.
 *
 * El arranque NUNCA debe lanzar excepciones: si falta DATABASE_URL o ADMIN_SECRET, la API
 * arranca igualmente, /health lo informa y las rutas que los necesitan responden 503.
 * (Antes, getDb() lanzaba al importar el módulo y Vercel devolvía FUNCTION_INVOCATION_FAILED
 * en TODAS las rutas, incluida /health.)
 */
function build(): (req: IncomingMessage, res: ServerResponse) => void {
  try {
    const { db, configured, ...rest } = resolveDb();
    if (!configured) console.warn(`[senso] ${"reason" in rest ? rest.reason : "BD no configurada"}: la API arranca sin base de datos`);
    const config = loadConfig();
    if (!config.adminConfigured) console.warn("[senso] ADMIN_SECRET no configurado: centro de monitoreo deshabilitado");
    return createApp({ db, config });
  } catch (err) {
    // Última red de seguridad: responder JSON en lugar de tumbar la función.
    console.error("[senso] error al inicializar la API", err);
    return (_req, res) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Error al inicializar la API" }));
    };
  }
}

export default build();
